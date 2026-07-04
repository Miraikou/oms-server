import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
import { PurchaseReceipt } from './entities/purchase-receipt.entity'
import { PurchaseReceiptItem } from './entities/purchase-receipt-item.entity'
import { PurchaseOrder } from './entities/purchase-order.entity'
import { PurchaseOrderItem } from './entities/purchase-order-item.entity'
import { Inventory } from '@/modules/inventory/entities/inventory.entity'
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity'
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { snowflake } from '@/common/utils/snowflake'
import type { CreatePurchaseReceiptDto, QueryPurchaseReceiptDto } from './dto/purchase-receipt.dto'

/**
 * 采购入库服务
 * 核心：8 步事务完成入库，同时更新库存
 */
@Injectable()
export class PurchaseReceiptService {
  private readonly logger = new Logger(PurchaseReceiptService.name)

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
      throw new BadRequestException('入库明细不能为空')
    }

    const receiptNo = await this.sequenceService.generate('CG') // 复用采购编号前缀

    // 在事务中执行所有步骤
    return this.dataSource.transaction(async (manager) => {
      // 步骤 1：校验采购单
      const order = await manager.findOne(PurchaseOrder, { where: { id: dto.purchaseOrderId } })
      if (!order) throw new BadRequestException('采购单不存在')
      if (order.status === 3) throw new BadRequestException('采购单已全部入库')
      if (order.status === 4) throw new BadRequestException('采购单已关闭')

      // 获取采购明细，校验入库数量
      const orderItems = await manager.find(PurchaseOrderItem, {
        where: { purchaseOrderId: dto.purchaseOrderId },
      })
      const orderItemMap = new Map(orderItems.map((i) => [i.id, i]))

      // 步骤 2：创建入库单
      const receipt = manager.create(PurchaseReceipt, {
        id: snowflake.nextId(),
        receiptNo,
        purchaseOrderId: dto.purchaseOrderId,
        receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : new Date(),
        remark: dto.remark || null,
      })
      const savedReceipt = await manager.save(receipt)

      // 步骤 2 续：创建入库明细
      const receiptItems: PurchaseReceiptItem[] = []
      for (const item of dto.items) {
        const orderItem = orderItemMap.get(item.purchaseOrderItemId)
        if (!orderItem) throw new BadRequestException(`采购明细 ${item.purchaseOrderItemId} 不存在`)

        const qty = parseFloat(item.quantity)
        const received = parseFloat(orderItem.receivedQuantity)
        const ordered = parseFloat(orderItem.quantity)
        const remaining = ordered - received

        if (qty <= 0) throw new BadRequestException('入库数量必须大于零')
        if (qty > remaining) {
          throw new BadRequestException(
            `入库数量(${qty})超过可入库数量(${remaining})`,
          )
        }

        const amount = qty * parseFloat(orderItem.unitPrice)
        const receiptItem = manager.create(PurchaseReceiptItem, {
          id: snowflake.nextId(),
          receiptId: savedReceipt.id,
          purchaseOrderItemId: item.purchaseOrderItemId,
          productId: orderItem.productId,
          quantity: item.quantity,
          unitPrice: orderItem.unitPrice,
          amount: amount.toFixed(2),
        })
        receiptItems.push(await manager.save(receiptItem))
      }

      // 步骤 3：为每个入库明细生成库存批次
      for (const ri of receiptItems) {
        const batchNo = await this.sequenceService.generate('BT')
        manager.create(InventoryBatch, {
          id: snowflake.nextId(),
          productId: ri.productId,
          receiptItemId: ri.id,
          batchSource: 1, // 采购入库
          batchNo,
          unitCost: ri.unitPrice,
          originalQuantity: ri.quantity,
          availableQuantity: ri.quantity,
          frozenQuantity: '0',
          stockQuantity: ri.quantity,
          inboundTime: savedReceipt.receiptDate,
          freezeStatus: 1,
          status: 1,
        })
        // 使用 save 保存（在事务中）
        const batch = manager.create(InventoryBatch, {
          id: snowflake.nextId(),
          productId: ri.productId,
          receiptItemId: ri.id,
          batchSource: 1,
          batchNo,
          unitCost: ri.unitPrice,
          originalQuantity: ri.quantity,
          availableQuantity: ri.quantity,
          frozenQuantity: '0',
          stockQuantity: ri.quantity,
          inboundTime: savedReceipt.receiptDate,
          freezeStatus: 1,
          status: 1,
        })
        const savedBatch = await manager.save(batch)

        // 步骤 4：更新采购明细已入库数量
        const orderItem = orderItemMap.get(ri.purchaseOrderItemId)!
        const newReceived = parseFloat(orderItem.receivedQuantity) + parseFloat(ri.quantity)
        orderItem.receivedQuantity = newReceived.toFixed(4)
        await manager.save(orderItem)

        // 步骤 5：更新库存汇总
        let inventory = await manager.findOne(Inventory, {
          where: { productId: ri.productId },
        })
        const qtyDelta = parseFloat(ri.quantity)
        if (!inventory) {
          inventory = manager.create(Inventory, {
            id: snowflake.nextId(),
            productId: ri.productId,
            availableQuantity: ri.quantity,
            frozenQuantity: '0',
            stockQuantity: ri.quantity,
            minimumStock: '0',
            version: 0,
          })
        } else {
          const available = parseFloat(inventory.availableQuantity) + qtyDelta
          const stock = parseFloat(inventory.stockQuantity) + qtyDelta
          inventory.availableQuantity = available.toFixed(4)
          inventory.stockQuantity = stock.toFixed(4)
          inventory.version += 1
        }
        const savedInventory = await manager.save(inventory)

        // 步骤 6：写入库存流水
        const beforeAvailable = (parseFloat(savedInventory.availableQuantity) - qtyDelta).toFixed(4)
        manager.create(InventoryFlow, {
          id: snowflake.nextId(),
          batchId: savedBatch.id,
          productId: ri.productId,
          businessType: 1, // 采购入库
          businessId: savedReceipt.id,
          changeType: 1, // 入库
          quantity: ri.quantity,
          unitCost: ri.unitPrice,
          totalCost: ri.amount,
          beforeAvailable,
          afterAvailable: savedInventory.availableQuantity,
          beforeFrozen: savedInventory.frozenQuantity,
          afterFrozen: savedInventory.frozenQuantity,
        })
        await manager.save(
          manager.create(InventoryFlow, {
            id: snowflake.nextId(),
            batchId: savedBatch.id,
            productId: ri.productId,
            businessType: 1,
            businessId: savedReceipt.id,
            changeType: 1,
            quantity: ri.quantity,
            unitCost: ri.unitPrice,
            totalCost: ri.amount,
            beforeAvailable,
            afterAvailable: savedInventory.availableQuantity,
            beforeFrozen: savedInventory.frozenQuantity,
            afterFrozen: savedInventory.frozenQuantity,
          }),
        )
      }

      // 步骤 7：重新计算采购单状态
      const updatedItems = await manager.find(PurchaseOrderItem, {
        where: { purchaseOrderId: dto.purchaseOrderId },
      })
      let allReceived = true
      let anyReceived = false
      for (const item of updatedItems) {
        const qty = parseFloat(item.quantity)
        const received = parseFloat(item.receivedQuantity)
        if (received > 0) anyReceived = true
        if (received < qty) allReceived = false
      }
      if (order.status !== 4) {
        if (allReceived) {
          order.status = 3
        } else if (anyReceived) {
          order.status = 2
        }
        await manager.save(order)
      }

      this.logger.log(`入库完成: ${receiptNo}, 采购单: ${order.purchaseNo}`)
      return savedReceipt
    })
  }

  /** 查询入库单列表 */
  async findAll(query: QueryPurchaseReceiptDto) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const qb = this.receiptRepo.createQueryBuilder('pr')

    if (query.purchaseOrderId) {
      qb.andWhere('pr.purchaseOrderId = :purchaseOrderId', { purchaseOrderId: query.purchaseOrderId })
    }

    qb.orderBy('pr.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }

  /** 查询入库单详情（含明细） */
  async findOne(id: string): Promise<PurchaseReceipt & { items?: PurchaseReceiptItem[] }> {
    const receipt = await this.receiptRepo.findOne({ where: { id } })
    if (!receipt) throw new BadRequestException('入库单不存在')
    const items = await this.receiptItemRepo.find({ where: { receiptId: id } })
    return { ...receipt, items }
  }
}
