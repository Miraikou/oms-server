import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, MoreThan, IsNull } from 'typeorm';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { InventoryAdjustmentItem } from './entities/inventory-adjustment-item.entity';
import { Inventory } from './entities/inventory.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { FifoService } from './services/fifo.service';
import {
  StockAlertService,
  type StockDecreaseItem,
} from './services/stock-alert.service';
import { RateService } from '@/common/rate/rate.service';
import { snowflake } from '@/common/utils/snowflake';
import { computeDualUnitPrice } from '@/common/utils/dual-currency';
import type {
  CreateInventoryAdjustmentDto,
  QueryInventoryAdjustmentDto,
  EstimateCostDto,
} from './dto/inventory-adjustment.dto';

/**
 * 库存调整服务
 * 支持指定批次调整和自动调整（增加生成新批次，减少按 FIFO 扣减）
 */
@Injectable()
export class InventoryAdjustmentService {
  private readonly logger = new Logger(InventoryAdjustmentService.name);

  constructor(
    @InjectRepository(InventoryAdjustment)
    private readonly adjustmentRepo: Repository<InventoryAdjustment>,
    @InjectRepository(InventoryAdjustmentItem)
    private readonly adjustmentItemRepo: Repository<InventoryAdjustmentItem>,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventoryBatch)
    private readonly batchRepo: Repository<InventoryBatch>,
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
    private readonly dataSource: DataSource,
    private readonly sequenceService: SequenceService,
    private readonly fifoService: FifoService,
    private readonly rateService: RateService,
    private readonly stockAlertService: StockAlertService,
  ) {}

  /** 创建库存调整 */
  async create(
    dto: CreateInventoryAdjustmentDto,
  ): Promise<InventoryAdjustment> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('调整明细不能为空');
    }

    const decreasedItems: StockDecreaseItem[] = [];
    const result = await this.dataSource.transaction(async (manager) => {
      const adjustmentNo = await this.sequenceService.generate('KC');

      const adjustment = manager.create(InventoryAdjustment, {
        id: snowflake.nextId(),
        adjustmentNo,
        adjustmentDate: new Date(),
        reason: dto.reason,
        remark: dto.remark || null,
      });
      const saved = await manager.save(InventoryAdjustment, adjustment);

      for (const item of dto.items) {
        const changeQty = parseFloat(item.changeQuantity);
        if (changeQty === 0) throw new BadRequestException('调整数量不能为零');

        // 保存调整明细
        const adjItem = manager.create(InventoryAdjustmentItem, {
          id: snowflake.nextId(),
          adjustmentId: saved.id,
          productId: item.productId,
          productModelId: item.productModelId || null,
          batchId: item.batchId || null,
          changeQuantity: item.changeQuantity,
        });
        await manager.save(InventoryAdjustmentItem, adjItem);

        if (changeQty > 0) {
          // 增加库存
          if (item.batchId) {
            // 指定批次：直接增加该批次
            const batch = await manager
              .createQueryBuilder(InventoryBatch, 'b')
              .setLock('pessimistic_write')
              .where('b.id = :id', { id: item.batchId })
              .getOne();
            if (!batch) throw new BadRequestException(`指定批次(${item.batchId})不存在`);
            if (batch.productId !== item.productId)
              throw new BadRequestException(
                `指定批次(${item.batchId})的商品与调整商品(${item.productId})不匹配`,
              );

            const beforeAvailable = batch.availableQuantity;
            batch.availableQuantity = (
              parseFloat(batch.availableQuantity) + changeQty
            ).toFixed(4);
            batch.stockQuantity = (
              parseFloat(batch.stockQuantity) + changeQty
            ).toFixed(4);
            batch.originalQuantity = (
              parseFloat(batch.originalQuantity) + changeQty
            ).toFixed(4);
            if (batch.status === 2) batch.status = 1;
            batch.version += 1;
            await manager.save(InventoryBatch, batch);

            // 更新库存汇总
            await this.addToInventory(item.productId, item.productModelId, changeQty, manager);

            // 写流水
            await this.writeAdjustmentFlow(
              batch.id,
              item.productId,
              item.productModelId,
              saved.id,
              item.changeQuantity,
              batch.unitCostUsd,
              batch.unitCostCny || '0',
              beforeAvailable,
              batch.availableQuantity,
              manager,
            );
          } else {
            // 未指定批次：生成新调整批次
            // 验证成本信息
            if (!item.costSourceType) {
              throw new BadRequestException('增加库存未指定批次时，必须提供成本来源类型');
            }

            let unitCostUsd: string;
            let unitCostCny: string;
            let currency: string;
            let exchangeRate: string;

            if (item.costSourceType === 4) {
              // 手动输入
              if (!item.unitPrice) {
                throw new BadRequestException('手动输入成本时必须提供单价');
              }
              currency = item.currency || 'CNY';
              exchangeRate = await this.rateService.getRate(
                new Date().toISOString().split('T')[0],
                'USD',
              );
              const dualPrice = computeDualUnitPrice(item.unitPrice, currency, exchangeRate);
              unitCostUsd = dualPrice.unitPriceUsd;
              unitCostCny = dualPrice.unitPriceCny;
            } else {
              // 自动估算
              const estimate = await this.estimateCostInternal(
                item.productId,
                item.productModelId || null,
                item.costSourceType,
              );
              currency = 'CNY';
              exchangeRate = await this.rateService.getRate(
                new Date().toISOString().split('T')[0],
                'USD',
              );
              const dualPrice = computeDualUnitPrice(estimate.costCny, 'CNY', exchangeRate);
              unitCostUsd = dualPrice.unitPriceUsd;
              unitCostCny = dualPrice.unitPriceCny;
            }

            const batchNo = await this.sequenceService.generate('BT');
            const batch = manager.create(InventoryBatch, {
              id: snowflake.nextId(),
              productId: item.productId,
              productModelId: item.productModelId || null,
              receiptItemId: null,
              batchSource: 3, // 库存调整
              batchNo,
              unitCostUsd,
              unitCostCny,
              currency,
              exchangeRate,
              originalQuantity: item.changeQuantity,
              availableQuantity: item.changeQuantity,
              frozenQuantity: '0',
              stockQuantity: item.changeQuantity,
              inboundTime: new Date(),
              status: 1,
            });
            const savedBatch = await manager.save(InventoryBatch, batch);

            // 保存成本来源信息到调整明细
            adjItem.costSourceType = item.costSourceType;
            adjItem.unitPriceUsd = unitCostUsd;
            adjItem.unitPriceCny = unitCostCny;
            adjItem.exchangeRate = exchangeRate;
            adjItem.currency = currency;
            await manager.save(InventoryAdjustmentItem, adjItem);

            await this.addToInventory(item.productId, item.productModelId, changeQty, manager);

            await this.writeAdjustmentFlow(
              savedBatch.id,
              item.productId,
              item.productModelId,
              saved.id,
              item.changeQuantity,
              unitCostUsd,
              unitCostCny,
              '0',
              item.changeQuantity,
              manager,
            );
          }
        } else {
          // 减少库存
          const absQty = Math.abs(changeQty);
          decreasedItems.push({
            productId: item.productId,
            productModelId: item.productModelId || null,
            decreasedQty: absQty,
          });
          if (item.batchId) {
            // 指定批次：只从该批次扣减
            const batch = await manager
              .createQueryBuilder(InventoryBatch, 'b')
              .setLock('pessimistic_write')
              .where('b.id = :id', { id: item.batchId })
              .getOne();
            if (!batch) throw new BadRequestException(`指定批次(${item.batchId})不存在`);
            if (batch.productId !== item.productId)
              throw new BadRequestException(
                `指定批次(${item.batchId})的商品与调整商品(${item.productId})不匹配`,
              );

            const batchAvail = parseFloat(batch.availableQuantity);
            if (batchAvail < absQty)
              throw new BadRequestException(
                `批次(${item.batchId})可用库存不足：需要 ${absQty}，可用 ${batchAvail}`,
              );

            const beforeAvailable = batch.availableQuantity;
            batch.availableQuantity = (batchAvail - absQty).toFixed(4);
            batch.stockQuantity = (
              parseFloat(batch.stockQuantity) - absQty
            ).toFixed(4);
            // 无预留模型：frozen 恒为 0，仅需判断 available
            if (parseFloat(batch.availableQuantity) <= 0) {
              batch.status = 2; // 耗尽
            }
            batch.version += 1;
            await manager.save(InventoryBatch, batch);

            // 更新库存汇总
            await this.addToInventory(item.productId, item.productModelId, -absQty, manager);

            // 写流水
            await this.writeAdjustmentFlow(
              batch.id,
              item.productId,
              item.productModelId,
              saved.id,
              item.changeQuantity,
              batch.unitCostUsd,
              batch.unitCostCny || '0',
              beforeAvailable,
              batch.availableQuantity,
              manager,
            );
          } else {
            // 未指定批次：调用 FIFO 引擎扣减（传入事务 manager，changeType=5 调整）
            await this.fifoService.consume(item.productId, item.productModelId, absQty, saved.id, 5, manager, 5);
          }
        }
      }

      this.logger.log(`库存调整完成: ${adjustmentNo}`);
      return saved;
    });

    // 事务提交后：库存预警检测（fire-and-forget，不影响业务流程）
    void this.stockAlertService.checkAndNotify(decreasedItems);

    return result;
  }

  /** 查询列表 */
  async findAll(query: QueryInventoryAdjustmentDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.adjustmentRepo.createQueryBuilder('a')
    if (query.adjustmentNo) {
      qb.andWhere('a.adjustmentNo = :adjustmentNo', { adjustmentNo: query.adjustmentNo });
    }
    if (query.reason) {
      qb.andWhere('a.reason = :reason', { reason: query.reason });
    }
    qb.orderBy('a.createdTime', 'DESC')
      .skip((page - 1) * pageSize) 
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /** 查询详情 */
  async findOne(id: string) {
    const adjustment = await this.adjustmentRepo.findOne({ where: { id } });
    if (!adjustment) throw new BadRequestException('调整单不存在');
    const items = await this.adjustmentItemRepo.find({
      where: { adjustmentId: id },
    });
    return { ...adjustment, items };
  }

  /** 辅助：增加库存汇总 */
  private async addToInventory(
    productId: string,
    productModelId: string | null | undefined,
    delta: number,
    manager: EntityManager,
  ): Promise<void> {
    let qb = manager
      .createQueryBuilder(Inventory, 'i')
      .setLock('pessimistic_write')
      .where('i.productId = :productId', { productId });

    if (productModelId) {
      qb = qb.andWhere('i.productModelId = :productModelId', { productModelId });
    } else {
      qb = qb.andWhere('i.productModelId IS NULL');
    }

    let inv = await qb.getOne();
    if (!inv) {
      inv = manager.create(Inventory, {
        id: snowflake.nextId(),
        productId,
        productModelId: productModelId || null,
        availableQuantity: String(delta),
        frozenQuantity: '0',
        stockQuantity: String(delta),
        version: 0,
      });
    } else {
      inv.availableQuantity = (
        parseFloat(inv.availableQuantity) + delta
      ).toFixed(4);
      inv.stockQuantity = (parseFloat(inv.stockQuantity) + delta).toFixed(4);
      inv.version += 1;
    }
    await manager.save(Inventory, inv);
  }

  /** 辅助：写调整流水 */
  private async writeAdjustmentFlow(
    batchId: string,
    productId: string,
    productModelId: string | null | undefined,
    businessId: string,
    quantity: string,
    unitCostUsd: string,
    unitCostCny: string,
    beforeAvailable: string,
    afterAvailable: string,
    manager: EntityManager,
  ): Promise<void> {
    const modelWhere = productModelId
      ? { productId, productModelId }
      : { productId, productModelId: IsNull() };
    const inv = await manager.findOne(Inventory, { where: modelWhere });
    const absQty = Math.abs(parseFloat(quantity));
    const totalCostUsd = (absQty * parseFloat(unitCostUsd)).toFixed(2);
    const totalCostCny = (absQty * parseFloat(unitCostCny)).toFixed(2);

    await manager.save(
      InventoryFlow,
      manager.create(InventoryFlow, {
        id: snowflake.nextId(),
        batchId,
        productId,
        productModelId: productModelId || null,
        businessType: 5, // 库存调整
        businessId,
        changeType: 5, // 库存调整
        quantity: String(absQty),
        unitCostUsd,
        unitCostCny,
        totalCostUsd,
        totalCostCny,
        beforeAvailable,
        afterAvailable,
        beforeFrozen: inv?.frozenQuantity || '0',
        afterFrozen: inv?.frozenQuantity || '0',
      }),
    );
  }

  /**
   * 估算成本（供前端调用）
   * @param dto 估算请求参数
   * @returns 估算结果：CNY成本、目标币种成本、汇率
   */
  async estimateCost(dto: EstimateCostDto) {
    const { productId, productModelId, costSourceType } = dto;

    if (costSourceType < 1 || costSourceType > 3) {
      throw new BadRequestException('成本来源类型无效，必须为 1-3');
    }

    const result = await this.estimateCostInternal(productId, productModelId || null, costSourceType);
    return result;
  }

  /**
   * 内部成本估算方法
   * @param productId 商品ID
   * @param productModelId 型号ID（null表示匹配型号为空的批次）
   * @param costSourceType 成本来源类型 1=近一年加权平均 2=剩余库存加权平均 3=最新采购记录成本
   * @returns { costCny: string }
   */
  private async estimateCostInternal(
    productId: string,
    productModelId: string | null,
    costSourceType: number,
  ): Promise<{ costCny: string }> {
    switch (costSourceType) {
      case 1:
        return this.calcYearlyWeightedAvg(productId, productModelId);
      case 2:
        return this.calcRemainingWeightedAvg(productId, productModelId);
      case 3:
        return this.calcLatestPurchaseCost(productId, productModelId);
      default:
        throw new BadRequestException('无效的成本来源类型');
    }
  }

  /**
   * 近一年加权平均成本
   * 使用 originalQuantity 作为权重，包含已消耗/冻结的批次
   */
  private async calcYearlyWeightedAvg(
    productId: string,
    productModelId: string | null,
  ): Promise<{ costCny: string }> {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const qb = this.batchRepo.createQueryBuilder('b')
      .where('b.productId = :productId', { productId })
      .andWhere('b.inboundTime >= :oneYearAgo', { oneYearAgo });

    if (productModelId) {
      qb.andWhere('b.productModelId = :productModelId', { productModelId });
    } else {
      qb.andWhere('b.productModelId IS NULL');
    }

    const batches = await qb.getMany();

    if (batches.length === 0) {
      throw new BadRequestException('该商品近一年无入库记录');
    }

    let totalCostCNY = 0;
    let totalQty = 0;
    for (const b of batches) {
      const qty = parseFloat(b.originalQuantity);
      const costBase = parseFloat(b.unitCostCny);
      totalCostCNY += costBase * qty;
      totalQty += qty;
    }

    if (totalQty <= 0) {
      throw new BadRequestException('该商品近一年无入库记录');
    }

    return { costCny: (totalCostCNY / totalQty).toFixed(4) };
  }

  /**
   * 剩余库存加权平均成本
   * 只考虑 availableQuantity > 0 的批次
   */
  private async calcRemainingWeightedAvg(
    productId: string,
    productModelId: string | null,
  ): Promise<{ costCny: string }> {
    const qb = this.batchRepo.createQueryBuilder('b')
      .where('b.productId = :productId', { productId })
      .andWhere('b.availableQuantity > 0');

    if (productModelId) {
      qb.andWhere('b.productModelId = :productModelId', { productModelId });
    } else {
      qb.andWhere('b.productModelId IS NULL');
    }

    const batches = await qb.getMany();

    if (batches.length === 0) {
      throw new BadRequestException('该商品无库存');
    }

    let totalCostCNY = 0;
    let totalQty = 0;
    for (const b of batches) {
      const qty = parseFloat(b.availableQuantity);
      const costBase = parseFloat(b.unitCostCny);
      totalCostCNY += costBase * qty;
      totalQty += qty;
    }

    if (totalQty <= 0) {
      throw new BadRequestException('该商品无库存');
    }

    return { costCny: (totalCostCNY / totalQty).toFixed(4) };
  }

  /**
   * 最新采购记录成本
   * 取最近入库批次的 unitCostCny
   */
  private async calcLatestPurchaseCost(
    productId: string,
    productModelId: string | null,
  ): Promise<{ costCny: string }> {
    const qb = this.batchRepo.createQueryBuilder('b')
      .where('b.productId = :productId', { productId });

    if (productModelId) {
      qb.andWhere('b.productModelId = :productModelId', { productModelId });
    } else {
      qb.andWhere('b.productModelId IS NULL');
    }

    qb.orderBy('b.inboundTime', 'DESC').limit(1);

    const batch = await qb.getOne();

    if (!batch) {
      throw new BadRequestException('该商品无采购记录');
    }

    return { costCny: parseFloat(batch.unitCostCny).toFixed(4) };
  }
}
