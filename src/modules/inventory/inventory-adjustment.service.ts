import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { InventoryAdjustmentItem } from './entities/inventory-adjustment-item.entity';
import { Inventory } from './entities/inventory.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { FifoService } from './services/fifo.service';
import { snowflake } from '@/common/utils/snowflake';
import type {
  CreateInventoryAdjustmentDto,
  QueryInventoryAdjustmentDto,
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
  ) {}

  /** 创建库存调整 */
  async create(
    dto: CreateInventoryAdjustmentDto,
  ): Promise<InventoryAdjustment> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('调整明细不能为空');
    }

    return this.dataSource.transaction(async (manager) => {
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
              batch.unitCost,
              beforeAvailable,
              batch.availableQuantity,
              manager,
            );
          } else {
            // 未指定批次：生成新调整批次
            const batchNo = await this.sequenceService.generate('BT');
            const batch = manager.create(InventoryBatch, {
              id: snowflake.nextId(),
              productId: item.productId,
              productModelId: item.productModelId || null,
              receiptItemId: null,
              batchSource: 3, // 库存调整
              batchNo,
              unitCost: '0',
              originalQuantity: item.changeQuantity,
              availableQuantity: item.changeQuantity,
              frozenQuantity: '0',
              stockQuantity: item.changeQuantity,
              inboundTime: new Date(),
              freezeStatus: 1,
              status: 1,
            });
            const savedBatch = await manager.save(InventoryBatch, batch);

            await this.addToInventory(item.productId, item.productModelId, changeQty, manager);

            await this.writeAdjustmentFlow(
              savedBatch.id,
              item.productId,
              item.productModelId,
              saved.id,
              item.changeQuantity,
              '0',
              '0',
              item.changeQuantity,
              manager,
            );
          }
        } else {
          // 减少库存
          const absQty = Math.abs(changeQty);
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
            if (
              parseFloat(batch.availableQuantity) <= 0 &&
              parseFloat(batch.frozenQuantity) <= 0
            ) {
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
              batch.unitCost,
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
        minimumStock: '0',
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
    unitCost: string,
    beforeAvailable: string,
    afterAvailable: string,
    manager: EntityManager,
  ): Promise<void> {
    const modelWhere = productModelId
      ? { productId, productModelId }
      : { productId, productModelId: undefined as any };
    const inv = await manager.findOne(Inventory, { where: modelWhere });
    const totalCost = (Math.abs(parseFloat(quantity)) * parseFloat(unitCost)).toFixed(2);

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
        quantity: String(Math.abs(parseFloat(quantity))),
        unitCost,
        totalCost,
        beforeAvailable,
        afterAvailable,
        beforeFrozen: inv?.frozenQuantity || '0',
        afterFrozen: inv?.frozenQuantity || '0',
      }),
    );
  }
}
