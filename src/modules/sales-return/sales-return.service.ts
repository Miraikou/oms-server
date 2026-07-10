import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SalesReturn } from './entities/sales-return.entity';
import { SalesReturnItem } from './entities/sales-return-item.entity';
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity';
import { ShipmentItemBatch } from '@/modules/shipment/entities/shipment-item-batch.entity';
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { SalesOrderService } from '@/modules/sales-order/sales-order.service';
import { snowflake } from '@/common/utils/snowflake';
import type {
  CreateSalesReturnDto,
  QuerySalesReturnDto,
} from './dto/sales-return.dto';

/**
 * 客户退货服务 ⭐
 * 7 步事务：创建退货单 → 恢复原批次库存 → 更新订单退货数量 → 重算状态
 */
@Injectable()
export class SalesReturnService {
  private readonly logger = new Logger(SalesReturnService.name);

  constructor(
    @InjectRepository(SalesReturn)
    private readonly returnRepo: Repository<SalesReturn>,
    @InjectRepository(SalesReturnItem)
    private readonly returnItemRepo: Repository<SalesReturnItem>,
    @InjectRepository(ShipmentItem)
    private readonly shipmentItemRepo: Repository<ShipmentItem>,
    @InjectRepository(ShipmentItemBatch)
    private readonly shipmentBatchRepo: Repository<ShipmentItemBatch>,
    @InjectRepository(InventoryBatch)
    private readonly inventoryBatchRepo: Repository<InventoryBatch>,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderItem)
    private readonly orderItemRepo: Repository<SalesOrderItem>,
    private readonly sequenceService: SequenceService,
    private readonly salesOrderService: SalesOrderService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 创建客户退货单（7 步事务）⭐
   */
  async create(dto: CreateSalesReturnDto): Promise<SalesReturn> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. 校验订单已发货
      const order = await manager.findOne(SalesOrder, {
        where: { id: dto.orderId },
      });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.shipmentStatus < 2) {
        throw new BadRequestException('订单尚未发货，无法退货');
      }

      // 2. 校验每个明细的退货数量
      for (const item of dto.items) {
        const shipItem = await manager.findOne(ShipmentItem, {
          where: { id: item.shipmentItemId },
        });
        if (!shipItem) {
          throw new BadRequestException(
            `发货明细 ${item.shipmentItemId} 不存在`,
          );
        }
        const returnQty = parseFloat(item.quantity);
        if (returnQty <= 0) throw new BadRequestException('退货数量必须大于零');

        // 查询该发货明细对应的历史退货数量
        const existingReturns = await manager.find(SalesReturnItem, {
          where: { shipmentItemId: item.shipmentItemId },
        });
        const totalReturned = existingReturns.reduce(
          (sum, r) => sum + parseFloat(r.quantity),
          0,
        );
        const returnable = parseFloat(shipItem.quantity) - totalReturned;
        if (returnQty > returnable) {
          throw new BadRequestException(
            `退货数量 ${returnQty} 超过可退数量 ${returnable}`,
          );
        }
      }

      // 3. 创建退货单 + 明细
      const returnNo = await this.sequenceService.generate('TH');
      const salesReturn = manager.create(SalesReturn, {
        id: snowflake.nextId(),
        returnNo,
        orderId: dto.orderId,
        returnDate: new Date(dto.returnDate),
        restoreInventory: dto.restoreInventory,
        reason: dto.reason || null,
        remark: dto.remark || null,
      });
      const savedReturn = await manager.save(salesReturn);

      for (const dtoItem of dto.items) {
        const shipItem = await manager.findOne(ShipmentItem, {
          where: { id: dtoItem.shipmentItemId },
        });
        const returnItem = manager.create(SalesReturnItem, {
          id: snowflake.nextId(),
          salesReturnId: savedReturn.id,
          shipmentItemId: dtoItem.shipmentItemId,
          productId: shipItem!.productId,
          productModelId: shipItem!.productModelId || null,
          quantity: dtoItem.quantity,
          restoreInventory: dto.restoreInventory,
        });
        await manager.save(returnItem);

        // 4. 恢复库存到原批次
        if (dto.restoreInventory === 1) {
          const shipBatches = await manager.find(ShipmentItemBatch, {
            where: { shipmentItemId: dtoItem.shipmentItemId },
          });
          const returnQty = parseFloat(dtoItem.quantity);
          let remaining = returnQty;

          // 按原批次比例恢复
          for (const sb of shipBatches) {
            if (remaining <= 0) break;
            const batchQty = parseFloat(sb.quantity);
            const toRestore = Math.min(batchQty, remaining);

            // 恢复库存批次
            const batch = await manager.findOne(InventoryBatch, {
              where: { id: sb.inventoryBatchId },
            });
            if (batch) {
              const beforeAvailable = parseFloat(batch.availableQuantity);
              const beforeFrozen = parseFloat(batch.frozenQuantity);

              batch.availableQuantity = (beforeAvailable + toRestore).toFixed(
                4,
              );
              batch.stockQuantity = (
                parseFloat(batch.stockQuantity) + toRestore
              ).toFixed(4);

              // 如果批次已耗尽，恢复为有效
              if (batch.status === 2) batch.status = 1;

              batch.version += 1;
              await manager.save(batch);

              // 更新库存汇总（加悲观锁防止并发覆盖）
              const invModelWhere = batch.productModelId
                ? 'i.productModelId = :productModelId'
                : 'i.productModelId IS NULL';
              const invModelParams = batch.productModelId
                ? { productModelId: batch.productModelId }
                : {};
              const inventory = await manager
                .createQueryBuilder(Inventory, 'i')
                .setLock('pessimistic_write')
                .where('i.productId = :productId', { productId: shipItem!.productId })
                .andWhere(invModelWhere, invModelParams)
                .getOne();
              if (inventory) {
                inventory.availableQuantity = (
                  parseFloat(inventory.availableQuantity) + toRestore
                ).toFixed(4);
                inventory.stockQuantity = (
                  parseFloat(inventory.stockQuantity) + toRestore
                ).toFixed(4);
                inventory.version += 1;
                await manager.save(inventory);

                // 写库存流水
                const flow = manager.create(InventoryFlow, {
                  id: snowflake.nextId(),
                  batchId: batch.id,
                  productId: shipItem!.productId,
                  productModelId: batch.productModelId || null,
                  businessType: 3, // 客户退货
                  businessId: savedReturn.id,
                  changeType: 1, // 入库
                  quantity: String(toRestore),
                  unitCost: sb.unitCost,
                  totalCost: (toRestore * parseFloat(sb.unitCost)).toFixed(2),
                  beforeAvailable: beforeAvailable.toFixed(4),
                  afterAvailable: (beforeAvailable + toRestore).toFixed(4),
                  beforeFrozen: beforeFrozen.toFixed(4),
                  afterFrozen: beforeFrozen.toFixed(4),
                });
                await manager.save(flow);
              }
            }

            remaining -= toRestore;
          }
        }

        // 5. 更新订单明细 returnedQuantity（精确到发货明细对应的 orderItemId）
        const orderItem = await manager.findOne(SalesOrderItem, {
          where: { id: shipItem!.orderItemId },
        });
        if (orderItem) {
          orderItem.returnedQuantity = (
            parseFloat(orderItem.returnedQuantity) +
            parseFloat(dtoItem.quantity)
          ).toFixed(4);
          await manager.save(orderItem);
        }
      }

      this.logger.log(`客户退货完成: ${returnNo}, 订单: ${order.orderNo}`);
      return savedReturn;
    });
  }

  /**
   * 查询退货详情（含明细）
   */
  async findOne(id: string) {
    const ret = await this.returnRepo.findOne({ where: { id } });
    if (!ret) throw new BadRequestException('退货单不存在');
    const items = await this.returnItemRepo.find({
      where: { salesReturnId: id },
    });
    return { ...ret, items };
  }

  /**
   * 分页查询退货列表
   */
  async findAll(query: QuerySalesReturnDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.returnRepo.createQueryBuilder('r');

    if (query.returnNo) {
      qb.andWhere('r.returnNo LIKE :no', { no: `%${query.returnNo}%` });
    }
    if (query.orderId) {
      qb.andWhere('r.orderId = :orderId', { orderId: query.orderId });
    }
    if (query.startDate) {
      qb.andWhere('r.returnDate >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('r.returnDate <= :endDate', { endDate: query.endDate });
    }

    const sortField = query.sortField || 'createdTime';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`r.${sortField}`, sortOrder)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }
}
