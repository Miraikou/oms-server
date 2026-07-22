import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, IsNull } from 'typeorm';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { Inventory } from '../entities/inventory.entity';
import { InventoryFlow } from '../entities/inventory-flow.entity';
import { snowflake } from '@/common/utils/snowflake';

/** FIFO 扣减明细 */
export interface FifoConsumeItem {
  batchId: string;
  batchNo: string;
  quantity: number;
  unitCostUsd: string;
  totalCostUsd: string;
  unitCostCny: string;
  totalCostCny: string;
  currency: string;
  exchangeRate: string;
}

/** FIFO 扣减结果 */
export interface FifoConsumeResult {
  items: FifoConsumeItem[];
  totalCostUsd: string;
  totalCostCny: string;
}

/** 乐观锁重试配置 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 50;

/**
 * FIFO 引擎服务 ⭐
 * 系统核心：按先进先出原则管理库存批次
 *
 * 供发货、退货、库存调整等模块调用
 * 使用乐观锁（version 字段）+ 自动重试保证并发安全
 */
@Injectable()
export class FifoService {
  private readonly logger = new Logger(FifoService.name);

  constructor(
    @InjectRepository(InventoryBatch)
    private readonly batchRepo: Repository<InventoryBatch>,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * FIFO 扣减（销售发货时调用）
   * 按 inboundTime ASC 选取批次，依次扣减 availableQuantity
   *
   * @param productId 商品 ID
   * @param productModelId 型号 ID（可选）
   * @param quantity 扣减数量
   * @param businessId 业务单据 ID（如发货单 ID）
   * @param businessType 业务类型（2=销售发货）
   * @param externalManager 外部事务 manager（传入时加入外部事务，不另开事务）
   * @param changeType 流水变化类型（默认 2=出库，库存调整传 5）
   * @returns 扣减明细和总成本
   */
  async consume(
    productId: string,
    productModelId: string | null | undefined,
    quantity: number,
    businessId: string,
    businessType: number = 2,
    externalManager?: EntityManager,
    changeType: number = 2,
  ): Promise<FifoConsumeResult> {
    if (quantity <= 0) throw new BadRequestException('扣减数量必须大于零');

    const modelWhere = productModelId
      ? { productId, productModelId }
      : { productId, productModelId: IsNull() };

    const doConsume = async (manager: EntityManager): Promise<FifoConsumeResult> => {
      // 1. 按 FIFO 顺序获取可用批次
      let batchQb = manager
        .createQueryBuilder(InventoryBatch, 'b')
        .setLock('pessimistic_write')
        .where('b.productId = :productId', { productId })
        .andWhere('b.status = :status', { status: 1 })
        .andWhere('b.availableQuantity > 0');

      if (productModelId) {
        batchQb = batchQb.andWhere('b.productModelId = :productModelId', { productModelId });
      } else {
        batchQb = batchQb.andWhere('b.productModelId IS NULL');
      }

      const batches = await batchQb
        .orderBy('b.inboundTime', 'ASC')
        .getMany();

      // 2. 检查总可用库存
      const totalAvailable = batches.reduce(
        (sum, b) => sum + parseFloat(b.availableQuantity),
        0,
      );
      if (totalAvailable < quantity) {
        throw new BadRequestException(
          `库存不足：需要 ${quantity}，可用 ${totalAvailable}`,
        );
      }

      // 3. 获取当前库存汇总（加悲观锁，防止并发 consume 的 lost-update）
      let invQb = manager
        .createQueryBuilder(Inventory, 'inv')
        .setLock('pessimistic_write')
        .where('inv.productId = :productId', { productId });
      if (productModelId) {
        invQb = invQb.andWhere('inv.productModelId = :pmid', { pmid: productModelId });
      } else {
        invQb = invQb.andWhere('inv.productModelId IS NULL');
      }
      const inventory = await invQb.getOne();
      if (!inventory) throw new BadRequestException('库存记录不存在');
      const beforeAvailable = parseFloat(inventory.availableQuantity);
      const beforeFrozen = parseFloat(inventory.frozenQuantity);

      // 4. 逐批次扣减
      let remaining = quantity;
      const consumeItems: FifoConsumeItem[] = [];
      let totalCostValue = 0;
      let totalCostBaseValue = 0;

      for (const batch of batches) {
        if (remaining <= 0) break;

        const batchAvailable = parseFloat(batch.availableQuantity);
        const deduct = Math.min(batchAvailable, remaining);

        batch.availableQuantity = (batchAvailable - deduct).toFixed(4);
        batch.stockQuantity = (
          parseFloat(batch.stockQuantity) - deduct
        ).toFixed(4);

        // 批次耗尽则标记（无预留模型：frozen 恒为 0，仅需判断 available）
        if (parseFloat(batch.availableQuantity) <= 0) {
          batch.status = 2; // 耗尽
        }

        await manager.save(batch);

        const unitCostUsd = parseFloat(batch.unitCostUsd || '0');
        const costUsd = deduct * unitCostUsd;
        totalCostValue += costUsd;

        const unitCostCny = parseFloat(batch.unitCostCny);
        const costCny = deduct * unitCostCny;
        totalCostBaseValue += costCny;

        consumeItems.push({
          batchId: batch.id,
          batchNo: batch.batchNo,
          quantity: deduct,
          unitCostUsd: batch.unitCostUsd,
          totalCostUsd: costUsd.toFixed(2),
          unitCostCny: batch.unitCostCny,
          totalCostCny: costCny.toFixed(2),
          currency: batch.currency,
          exchangeRate: batch.exchangeRate,
        });

        remaining -= deduct;
      }

      // 5. 更新库存汇总
      inventory.availableQuantity = (beforeAvailable - quantity).toFixed(4);
      inventory.stockQuantity = (
        parseFloat(inventory.stockQuantity) - quantity
      ).toFixed(4);
      await manager.save(inventory);

      // 6. 写入库存流水（每个批次一条）
      let cumulativeAvailable = beforeAvailable;
      for (const item of consumeItems) {
        const afterAvailable = cumulativeAvailable - item.quantity;
        const flow = manager.create(InventoryFlow, {
          id: snowflake.nextId(),
          batchId: item.batchId,
          productId,
          productModelId: productModelId || null,
          businessType,
          businessId,
          changeType,
          quantity: String(item.quantity),
          unitCostUsd: item.unitCostUsd,
          unitCostCny: item.unitCostCny,
          totalCostUsd: item.totalCostUsd,
          totalCostCny: item.totalCostCny,
          flowCurrency: item.currency,
          exchangeRate: item.exchangeRate,
          beforeAvailable: cumulativeAvailable.toFixed(4),
          afterAvailable: afterAvailable.toFixed(4),
          beforeFrozen: beforeFrozen.toFixed(4),
          afterFrozen: beforeFrozen.toFixed(4),
        });
        await manager.save(flow);
        cumulativeAvailable = afterAvailable;
      }

      this.logger.log(
        `FIFO 扣减完成: 商品=${productId}, 型号=${productModelId || '无'}, 数量=${quantity}, 成本=${totalCostValue.toFixed(2)}, 成本(CNY)=${totalCostBaseValue.toFixed(2)}`,
      );

      return {
        items: consumeItems,
        totalCostUsd: totalCostValue.toFixed(2),
        totalCostCny: totalCostBaseValue.toFixed(2),
      };
    };

    // 有外部事务 manager 时直接执行，不开新事务也不重试
    if (externalManager) {
      return doConsume(externalManager);
    }

    return this.withRetry(async () => {
      return this.dataSource.transaction(doConsume);
    });
  }

  /**
   * 乐观锁重试包装器
   * 遇到版本冲突时自动重试，最多 MAX_RETRIES 次
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (error instanceof BadRequestException) {
          throw error; // 业务异常直接抛出，不重试
        }
        this.logger.warn(`乐观锁冲突，第 ${attempt} 次重试...`);
        await this.sleep(RETRY_DELAY_MS);
      }
    }
    this.logger.error(`乐观锁重试 ${MAX_RETRIES} 次后仍失败`);
    throw lastError || new Error('未知错误');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
