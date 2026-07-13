import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PurchaseReceipt } from './entities/purchase-receipt.entity';
import { PurchaseReceiptItem } from './entities/purchase-receipt-item.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity';
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { snowflake } from '@/common/utils/snowflake';
import type {
  CreatePurchaseReceiptDto,
  QueryPurchaseReceiptDto,
} from './dto/purchase-receipt.dto';

/**
 * 采购入库服务
 * 核心：8 步事务完成入库，同时更新库存
 */
@Injectable()
export class PurchaseReceiptService {
  private readonly logger = new Logger(PurchaseReceiptService.name);

  constructor(
    @InjectRepository(PurchaseReceipt)
    private readonly receiptRepo: Repository<PurchaseReceipt>,
    @InjectRepository(PurchaseReceiptItem)
    private readonly receiptItemRepo: Repository<PurchaseReceiptItem>,
    @InjectRepository(PurchaseOrder)
    private readonly orderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderItem)
    private readonly orderItemRepo: Repository<PurchaseOrderItem>,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventoryBatch)
    private readonly batchRepo: Repository<InventoryBatch>,
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
    private readonly sequenceService: SequenceService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 创建入库单（8 步事务）
   *
   * 1. 校验采购单状态和入库数量
   * 2. 创建入库单 + 入库明细
   * 3. 为每个入库明细生成库存批次
   * 4. 更新采购明细已入库数量
   * 5. 更新库存汇总
   * 6. 写入库存流水
   * 7. 重新计算采购单状态
   * 8. 提交事务
   */
  async createReceipt(dto: CreatePurchaseReceiptDto): Promise<PurchaseReceipt> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }

    const receiptNo = await this.sequenceService.generate('RK');

    // 在事务中执行所有步骤
    return this.dataSource.transaction(async (manager) => {
      // 步骤 1：校验采购单
      const order = await manager.findOne(PurchaseOrder, {
        where: { id: dto.purchaseOrderId },
      });
      if (!order) throw new BadRequestException('采购单不存在');
      if (order.status === 3) throw new BadRequestException('采购单已全部入库');
      if (order.status === 4) throw new BadRequestException('采购单已关闭');

      // 获取采购明细，校验入库数量
      const orderItems = await manager.find(PurchaseOrderItem, {
        where: { purchaseOrderId: dto.purchaseOrderId },
      });
      const orderItemMap = new Map(orderItems.map((i) => [i.id, i]));

      // 步骤 2：创建入库单
      const receipt = manager.create(PurchaseReceipt, {
        id: snowflake.nextId(),
        receiptNo,
        purchaseOrderId: dto.purchaseOrderId,
        receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : new Date(),
        remark: dto.remark || null,
      });
      const savedReceipt = await manager.save(receipt);

      // 步骤 2 续：创建入库明细
      const receiptItems: PurchaseReceiptItem[] = [];
      for (const item of dto.items) {
        const orderItem = orderItemMap.get(item.purchaseOrderItemId);
        if (!orderItem)
          throw new BadRequestException(
            `采购明细 ${item.purchaseOrderItemId} 不存在`,
          );

        const qty = parseFloat(item.quantity);
        const received = parseFloat(orderItem.receivedQuantity);
        const ordered = parseFloat(orderItem.quantity);
        const remaining = ordered - received;

        if (qty <= 0) throw new BadRequestException('入库数量必须大于零');
        if (qty > remaining) {
          throw new BadRequestException(
            `入库数量(${qty})超过可入库数量(${remaining})`,
          );
        }

        const amount = qty * parseFloat(orderItem.unitPrice);
        const poRate = parseFloat(order.exchangeRate || '1');
        const receiptItem = manager.create(PurchaseReceiptItem, {
          id: snowflake.nextId(),
          receiptId: savedReceipt.id,
          purchaseOrderItemId: item.purchaseOrderItemId,
          productId: orderItem.productId,
          productModelId: orderItem.productModelId || null,
          quantity: item.quantity,
          unitPrice: orderItem.unitPrice,
          amount: amount.toFixed(2),
          baseAmount: (amount * poRate).toFixed(2),
        });
        receiptItems.push(await manager.save(receiptItem));
      }

      // 步骤 3：为每个入库明细生成库存批次
      for (const ri of receiptItems) {
        const batchNo = await this.sequenceService.generate('BT');
        const batch = manager.create(InventoryBatch, {
          id: snowflake.nextId(),
          productId: ri.productId,
          productModelId: ri.productModelId || null,
          receiptItemId: ri.id,
          batchSource: 1,
          batchNo,
          unitCost: ri.unitPrice,
          unitCostBase: ri.baseAmount
            ? (parseFloat(ri.baseAmount) / parseFloat(ri.quantity)).toFixed(2)
            : ri.unitPrice,
          currency: order.currency || 'CNY',
          exchangeRate: order.exchangeRate || '1',
          originalQuantity: ri.quantity,
          availableQuantity: ri.quantity,
          frozenQuantity: '0',
          stockQuantity: ri.quantity,
          inboundTime: savedReceipt.receiptDate,
          freezeStatus: 1,
          status: 1,
        });
        const savedBatch = await manager.save(batch);

        // 步骤 4：更新采购明细已入库数量
        const orderItem = orderItemMap.get(ri.purchaseOrderItemId)!;
        const newReceived =
          parseFloat(orderItem.receivedQuantity) + parseFloat(ri.quantity);
        orderItem.receivedQuantity = newReceived.toFixed(4);
        await manager.save(orderItem);

        // 步骤 5：更新库存汇总（加悲观锁防止并发覆盖）
        let inventory = await manager
          .createQueryBuilder(Inventory, 'i')
          .setLock('pessimistic_write')
          .where('i.productId = :productId', { productId: ri.productId })
          .andWhere(
            ri.productModelId
              ? 'i.productModelId = :productModelId'
              : 'i.productModelId IS NULL',
            ri.productModelId ? { productModelId: ri.productModelId } : {},
          )
          .getOne();
        const qtyDelta = parseFloat(ri.quantity);
        if (!inventory) {
          inventory = manager.create(Inventory, {
            id: snowflake.nextId(),
            productId: ri.productId,
            productModelId: ri.productModelId || null,
            availableQuantity: ri.quantity,
            frozenQuantity: '0',
            stockQuantity: ri.quantity,
            minimumStock: '0',
            version: 0,
          });
        } else {
          const available = parseFloat(inventory.availableQuantity) + qtyDelta;
          const stock = parseFloat(inventory.stockQuantity) + qtyDelta;
          inventory.availableQuantity = available.toFixed(4);
          inventory.stockQuantity = stock.toFixed(4);
          inventory.version += 1;
        }
        const savedInventory = await manager.save(inventory);

        // 步骤 6：写入库存流水
        const beforeAvailable = (
          parseFloat(savedInventory.availableQuantity) - qtyDelta
        ).toFixed(4);
        await manager.save(
          manager.create(InventoryFlow, {
            id: snowflake.nextId(),
            batchId: savedBatch.id,
            productId: ri.productId,
            productModelId: ri.productModelId || null,
            businessType: 1,
            businessId: savedReceipt.id,
            changeType: 1,
            quantity: ri.quantity,
            unitCost: ri.unitPrice,
            totalCost: ri.amount,
            totalCostBase: ri.baseAmount,
            flowCurrency: order.currency || 'CNY',
            flowExchangeRate: order.exchangeRate || '1',
            beforeAvailable,
            afterAvailable: savedInventory.availableQuantity,
            beforeFrozen: savedInventory.frozenQuantity,
            afterFrozen: savedInventory.frozenQuantity,
          }),
        );
      }

      // 步骤 7：重新计算采购单状态
      const updatedItems = await manager.find(PurchaseOrderItem, {
        where: { purchaseOrderId: dto.purchaseOrderId },
      });
      let allReceived = true;
      let anyReceived = false;
      for (const item of updatedItems) {
        const qty = parseFloat(item.quantity);
        const received = parseFloat(item.receivedQuantity);
        if (received > 0) anyReceived = true;
        if (received < qty) allReceived = false;
      }
      if (order.status !== 4) {
        if (allReceived) {
          order.status = 3;
        } else if (anyReceived) {
          order.status = 2;
        }
        await manager.save(order);
      }

      this.logger.log(`入库完成: ${receiptNo}, 采购单: ${order.purchaseNo}`);
      return savedReceipt;
    });
  }

  /** 查询入库单列表 */
  async findAll(query: QueryPurchaseReceiptDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.receiptRepo
      .createQueryBuilder('pr')
      .leftJoinAndSelect('pr.purchaseOrder', 'po');

    if (query.purchaseOrderId) {
      qb.andWhere('pr.purchaseOrderId = :purchaseOrderId', {
        purchaseOrderId: query.purchaseOrderId,
      });
    }

    qb.orderBy('pr.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    
    // 扁平化：将 purchaseOrder.purchaseNo 提升到顶层
    const flatList = list.map((receipt) => ({
      ...receipt,
      purchaseNo: receipt.purchaseOrder?.purchaseNo,
      purchaseOrder: undefined,
    }));
    
    return { list: flatList, total, page, pageSize };
  }

  /** 查询入库单详情（含明细和采购单币种） */
  async findOne(
    id: string,
  ): Promise<PurchaseReceipt & { items?: PurchaseReceiptItem[]; currency?: string, purchaseNo?: string }> {
    const receipt = await this.receiptRepo.findOne({ where: { id } });
    if (!receipt) throw new BadRequestException('入库单不存在');
    const items = await this.receiptItemRepo.find({ where: { receiptId: id } });
    const order = await this.orderRepo.findOne({
      where: { id: receipt.purchaseOrderId },
      select: { currency: true, purchaseNo: true } as Record<string, boolean>,
    });
    
    return { ...receipt, items, currency: order?.currency, purchaseNo: order?.purchaseNo };
  }
}
