import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InventoryBatch } from '../entities/inventory-batch.entity';
import { Inventory } from '../entities/inventory.entity';
import { InventoryFlow } from '../entities/inventory-flow.entity';
import { snowflake } from '@/common/utils/snowflake';

/** FIFO 扣减明细 */
export interface FifoConsumeItem {
  batchId: string;
  batchNo: string;
  quantity: number;
  unitCost: string;
  totalCost: string;
}

/** FIFO 扣减结果 */
export interface FifoConsumeResult {
  items: FifoConsumeItem[];
  totalCost: string;
}

/** 冻结/解冻结果 */
export interface FreezeResult {
  items: Array<{ batchId: string; batchNo: string; quantity: number }>;
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
   * @param quantity 扣减数量
   * @param businessId 业务单据 ID（如发货单 ID）
   * @param businessType 业务类型（2=销售发货）
   * @returns 扣减明细和总成本
   */
  async consume(
    productId: string,
    quantity: number,
    businessId: string,
    businessType: number = 2,
  ): Promise<FifoConsumeResult> {
    if (quantity <= 0) throw new BadRequestException('扣减数量必须大于零');

    return this.withRetry(async () => {
      return this.dataSource.transaction(async (manager) => {
        // 1. 按 FIFO 顺序获取可用批次
        const batches = await manager
          .createQueryBuilder(InventoryBatch, 'b')
          .setLock('pessimistic_write')
          .where('b.productId = :productId', { productId })
          .andWhere('b.status = :status', { status: 1 })
          .andWhere('b.availableQuantity > 0')
          .orderBy('b.inboundTime', 'ASC')
          .getMany();

        // 2. 检查总可用库存
        const totalAvailable = batches.reduce(
          (sum, b) => sum + parseFloat(b.availableQuantity),
          0,
        );
        if (totalAvailable < quantity) {
          throw new BadRequestException(
            `库存不足：需要 ${quantity}，可用 ${totalAvailable.toFixed(4)}`,
          );
        }

        // 3. 获取当前库存汇总
        const inventory = await manager.findOne(Inventory, {
          where: { productId },
        });
        if (!inventory) throw new BadRequestException('库存记录不存在');
        const beforeAvailable = parseFloat(inventory.availableQuantity);
        const beforeFrozen = parseFloat(inventory.frozenQuantity);

        // 4. 逐批次扣减
        let remaining = quantity;
        const consumeItems: FifoConsumeItem[] = [];
        let totalCostValue = 0;

        for (const batch of batches) {
          if (remaining <= 0) break;

          const batchAvailable = parseFloat(batch.availableQuantity);
          const deduct = Math.min(batchAvailable, remaining);

          batch.availableQuantity = (batchAvailable - deduct).toFixed(4);
          batch.stockQuantity = (
            parseFloat(batch.stockQuantity) - deduct
          ).toFixed(4);

          // 批次耗尽则标记
          if (
            parseFloat(batch.availableQuantity) <= 0 &&
            parseFloat(batch.frozenQuantity) <= 0
          ) {
            batch.status = 2; // 耗尽
          }

          batch.version += 1;
          await manager.save(batch);

          const unitCost = parseFloat(batch.unitCost);
          const cost = deduct * unitCost;
          totalCostValue += cost;

          consumeItems.push({
            batchId: batch.id,
            batchNo: batch.batchNo,
            quantity: deduct,
            unitCost: batch.unitCost,
            totalCost: cost.toFixed(2),
          });

          remaining -= deduct;
        }

        // 5. 更新库存汇总
        inventory.availableQuantity = (beforeAvailable - quantity).toFixed(4);
        inventory.stockQuantity = (
          parseFloat(inventory.stockQuantity) - quantity
        ).toFixed(4);
        inventory.version += 1;
        await manager.save(inventory);

        // 6. 写入库存流水（每个批次一条）
        let cumulativeAvailable = beforeAvailable;
        for (const item of consumeItems) {
          const afterAvailable = cumulativeAvailable - item.quantity;
          const flow = manager.create(InventoryFlow, {
            id: snowflake.nextId(),
            batchId: item.batchId,
            productId,
            businessType,
            businessId,
            changeType: 2, // 出库
            quantity: String(item.quantity),
            unitCost: item.unitCost,
            totalCost: item.totalCost,
            beforeAvailable: cumulativeAvailable.toFixed(4),
            afterAvailable: afterAvailable.toFixed(4),
            beforeFrozen: beforeFrozen.toFixed(4),
            afterFrozen: beforeFrozen.toFixed(4),
          });
          await manager.save(flow);
          cumulativeAvailable = afterAvailable;
        }

        this.logger.log(
          `FIFO 扣减完成: 商品=${productId}, 数量=${quantity}, 成本=${totalCostValue.toFixed(2)}`,
        );

        return {
          items: consumeItems,
          totalCost: totalCostValue.toFixed(2),
        };
      });
    });
  }

  /**
   * 冻结库存（订单创建时调用）
   * 按 FIFO 选取批次，将 availableQuantity 转移到 frozenQuantity
   */
  async freeze(
    productId: string,
    quantity: number,
    orderId: string,
  ): Promise<FreezeResult> {
    if (quantity <= 0) throw new BadRequestException('冻结数量必须大于零');

    return this.withRetry(async () => {
      return this.dataSource.transaction(async (manager) => {
        const batches = await manager
          .createQueryBuilder(InventoryBatch, 'b')
          .setLock('pessimistic_write')
          .where('b.productId = :productId', { productId })
          .andWhere('b.status = :status', { status: 1 })
          .andWhere('b.availableQuantity > 0')
          .orderBy('b.inboundTime', 'ASC')
          .getMany();

        const totalAvailable = batches.reduce(
          (sum, b) => sum + parseFloat(b.availableQuantity),
          0,
        );
        if (totalAvailable < quantity) {
          throw new BadRequestException(
            `可销售库存不足：需要 ${quantity}，可用 ${totalAvailable.toFixed(4)}`,
          );
        }

        const inventory = await manager.findOne(Inventory, {
          where: { productId },
        });
        if (!inventory) throw new BadRequestException('库存记录不存在');

        const beforeAvailable = parseFloat(inventory.availableQuantity);
        const beforeFrozen = parseFloat(inventory.frozenQuantity);

        let remaining = quantity;
        const freezeItems: FreezeResult['items'] = [];
        let cumulativeAvailable = beforeAvailable;
        let cumulativeFrozen = beforeFrozen;

        for (const batch of batches) {
          if (remaining <= 0) break;

          const batchAvailable = parseFloat(batch.availableQuantity);
          const toFreeze = Math.min(batchAvailable, remaining);

          batch.availableQuantity = (batchAvailable - toFreeze).toFixed(4);
          batch.frozenQuantity = (
            parseFloat(batch.frozenQuantity) + toFreeze
          ).toFixed(4);

          // 更新冻结状态
          const batchFrozen = parseFloat(batch.frozenQuantity);
          const batchAvailableAfter = parseFloat(batch.availableQuantity);
          if (batchFrozen > 0 && batchAvailableAfter > 0) {
            batch.freezeStatus = 2; // 部分冻结
          } else if (batchFrozen > 0 && batchAvailableAfter <= 0) {
            batch.freezeStatus = 3; // 全部冻结
          }

          batch.version += 1;
          await manager.save(batch);

          freezeItems.push({
            batchId: batch.id,
            batchNo: batch.batchNo,
            quantity: toFreeze,
          });

          // 写流水
          const afterAvailable = cumulativeAvailable - toFreeze;
          const afterFrozen = cumulativeFrozen + toFreeze;
          const flow = manager.create(InventoryFlow, {
            id: snowflake.nextId(),
            batchId: batch.id,
            productId,
            businessType: 6, // 下单冻结
            businessId: orderId,
            changeType: 3, // 冻结
            quantity: String(toFreeze),
            beforeAvailable: cumulativeAvailable.toFixed(4),
            afterAvailable: afterAvailable.toFixed(4),
            beforeFrozen: cumulativeFrozen.toFixed(4),
            afterFrozen: afterFrozen.toFixed(4),
          });
          await manager.save(flow);

          cumulativeAvailable = afterAvailable;
          cumulativeFrozen = afterFrozen;
          remaining -= toFreeze;
        }

        // 更新库存汇总
        inventory.availableQuantity = cumulativeAvailable.toFixed(4);
        inventory.frozenQuantity = cumulativeFrozen.toFixed(4);
        inventory.version += 1;
        await manager.save(inventory);

        this.logger.log(`库存冻结完成: 商品=${productId}, 数量=${quantity}`);
        return { items: freezeItems };
      });
    });
  }

  /**
   * 解冻库存（订单取消时调用）
   * 将 frozenQuantity 恢复到 availableQuantity
   */
  async unfreeze(
    productId: string,
    quantity: number,
    orderId: string,
  ): Promise<FreezeResult> {
    if (quantity <= 0) throw new BadRequestException('解冻数量必须大于零');

    return this.withRetry(async () => {
      return this.dataSource.transaction(async (manager) => {
        // 获取有冻结的批次
        const batches = await manager
          .createQueryBuilder(InventoryBatch, 'b')
          .setLock('pessimistic_write')
          .where('b.productId = :productId', { productId })
          .andWhere('b.frozenQuantity > 0')
          .orderBy('b.inboundTime', 'ASC')
          .getMany();

        const totalFrozen = batches.reduce(
          (sum, b) => sum + parseFloat(b.frozenQuantity),
          0,
        );
        if (totalFrozen < quantity) {
          throw new BadRequestException(
            `冻结库存不足：需要解冻 ${quantity}，当前冻结 ${totalFrozen.toFixed(4)}`,
          );
        }

        const inventory = await manager.findOne(Inventory, {
          where: { productId },
        });
        if (!inventory) throw new BadRequestException('库存记录不存在');

        const beforeAvailable = parseFloat(inventory.availableQuantity);
        const beforeFrozen = parseFloat(inventory.frozenQuantity);

        let remaining = quantity;
        const unfreezeItems: FreezeResult['items'] = [];
        let cumulativeAvailable = beforeAvailable;
        let cumulativeFrozen = beforeFrozen;

        for (const batch of batches) {
          if (remaining <= 0) break;

          const batchFrozen = parseFloat(batch.frozenQuantity);
          const toUnfreeze = Math.min(batchFrozen, remaining);

          batch.frozenQuantity = (batchFrozen - toUnfreeze).toFixed(4);
          batch.availableQuantity = (
            parseFloat(batch.availableQuantity) + toUnfreeze
          ).toFixed(4);

          // 更新冻结状态
          const batchFrozenAfter = parseFloat(batch.frozenQuantity);
          if (batchFrozenAfter <= 0) {
            batch.freezeStatus = 1; // 正常
          } else {
            batch.freezeStatus = 2; // 部分冻结
          }

          // 如果批次已耗尽且可用>0，确保 status 为有效
          if (batch.status === 2 && parseFloat(batch.availableQuantity) > 0) {
            batch.status = 1;
          }

          batch.version += 1;
          await manager.save(batch);

          unfreezeItems.push({
            batchId: batch.id,
            batchNo: batch.batchNo,
            quantity: toUnfreeze,
          });

          // 写流水
          const afterAvailable = cumulativeAvailable + toUnfreeze;
          const afterFrozen = cumulativeFrozen - toUnfreeze;
          const flow = manager.create(InventoryFlow, {
            id: snowflake.nextId(),
            batchId: batch.id,
            productId,
            businessType: 7, // 解冻库存
            businessId: orderId,
            changeType: 4, // 解冻
            quantity: String(toUnfreeze),
            beforeAvailable: cumulativeAvailable.toFixed(4),
            afterAvailable: afterAvailable.toFixed(4),
            beforeFrozen: cumulativeFrozen.toFixed(4),
            afterFrozen: afterFrozen.toFixed(4),
          });
          await manager.save(flow);

          cumulativeAvailable = afterAvailable;
          cumulativeFrozen = afterFrozen;
          remaining -= toUnfreeze;
        }

        // 更新库存汇总
        inventory.availableQuantity = cumulativeAvailable.toFixed(4);
        inventory.frozenQuantity = cumulativeFrozen.toFixed(4);
        inventory.version += 1;
        await manager.save(inventory);

        this.logger.log(`库存解冻完成: 商品=${productId}, 数量=${quantity}`);
        return { items: unfreezeItems };
      });
    });
  }

  /**
   * 扣减冻结库存（发货后调用）
   * 从已冻结批次中扣除，更新 stockQuantity
   */
  async deductFrozen(
    productId: string,
    quantity: number,
    businessId: string,
    businessType: number = 2,
  ): Promise<FifoConsumeResult> {
    if (quantity <= 0) throw new BadRequestException('扣减数量必须大于零');

    return this.withRetry(async () => {
      return this.dataSource.transaction(async (manager) => {
        // 获取有冻结的批次
        const batches = await manager
          .createQueryBuilder(InventoryBatch, 'b')
          .setLock('pessimistic_write')
          .where('b.productId = :productId', { productId })
          .andWhere('b.frozenQuantity > 0')
          .orderBy('b.inboundTime', 'ASC')
          .getMany();

        const totalFrozen = batches.reduce(
          (sum, b) => sum + parseFloat(b.frozenQuantity),
          0,
        );
        if (totalFrozen < quantity) {
          throw new BadRequestException(
            `冻结库存不足：需要扣减 ${quantity}，冻结 ${totalFrozen.toFixed(4)}`,
          );
        }

        const inventory = await manager.findOne(Inventory, {
          where: { productId },
        });
        if (!inventory) throw new BadRequestException('库存记录不存在');

        const beforeAvailable = parseFloat(inventory.availableQuantity);
        const beforeFrozen = parseFloat(inventory.frozenQuantity);

        let remaining = quantity;
        const consumeItems: FifoConsumeItem[] = [];
        let totalCostValue = 0;
        let cumulativeFrozen = beforeFrozen;
        let cumulativeStock = parseFloat(inventory.stockQuantity);

        for (const batch of batches) {
          if (remaining <= 0) break;

          const batchFrozen = parseFloat(batch.frozenQuantity);
          const toDeduct = Math.min(batchFrozen, remaining);

          batch.frozenQuantity = (batchFrozen - toDeduct).toFixed(4);
          batch.stockQuantity = (
            parseFloat(batch.stockQuantity) - toDeduct
          ).toFixed(4);

          // 批次耗尽标记
          if (
            parseFloat(batch.availableQuantity) <= 0 &&
            parseFloat(batch.frozenQuantity) <= 0
          ) {
            batch.status = 2;
          }

          // 更新冻结状态
          if (parseFloat(batch.frozenQuantity) <= 0) {
            batch.freezeStatus =
              parseFloat(batch.availableQuantity) > 0 ? 1 : 3;
          } else {
            batch.freezeStatus = 2;
          }

          batch.version += 1;
          await manager.save(batch);

          const unitCost = parseFloat(batch.unitCost);
          const cost = toDeduct * unitCost;
          totalCostValue += cost;

          consumeItems.push({
            batchId: batch.id,
            batchNo: batch.batchNo,
            quantity: toDeduct,
            unitCost: batch.unitCost,
            totalCost: cost.toFixed(2),
          });

          // 写流水
          const afterFrozen = cumulativeFrozen - toDeduct;
          const afterStock = cumulativeStock - toDeduct;
          const flow = manager.create(InventoryFlow, {
            id: snowflake.nextId(),
            batchId: batch.id,
            productId,
            businessType,
            businessId,
            changeType: 2, // 出库
            quantity: String(toDeduct),
            unitCost: batch.unitCost,
            totalCost: cost.toFixed(2),
            beforeAvailable: beforeAvailable.toFixed(4),
            afterAvailable: beforeAvailable.toFixed(4), // 可用不变（已在冻结时扣减）
            beforeFrozen: cumulativeFrozen.toFixed(4),
            afterFrozen: afterFrozen.toFixed(4),
          });
          await manager.save(flow);

          cumulativeFrozen = afterFrozen;
          cumulativeStock = afterStock;
          remaining -= toDeduct;
        }

        // 更新库存汇总（冻结减少，实际库存减少，可用不变）
        inventory.frozenQuantity = cumulativeFrozen.toFixed(4);
        inventory.stockQuantity = cumulativeStock.toFixed(4);
        inventory.version += 1;
        await manager.save(inventory);

        this.logger.log(`冻结扣减完成: 商品=${productId}, 数量=${quantity}`);
        return { items: consumeItems, totalCost: totalCostValue.toFixed(2) };
      });
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
