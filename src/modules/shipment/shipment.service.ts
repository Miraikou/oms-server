import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
import { Shipment } from './entities/shipment.entity'
import { ShipmentItem } from './entities/shipment-item.entity'
import { ShipmentItemBatch } from './entities/shipment-item-batch.entity'
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { FifoService } from '@/modules/inventory/services/fifo.service'
import { SalesOrderService } from '@/modules/sales-order/sales-order.service'
import { snowflake } from '@/common/utils/snowflake'
import type {
  CreateShipmentDto,
  QueryShipmentDto,
} from './dto/shipment.dto'

/**
 * 发货服务 ⭐
 * 核心业务：8 步事务完成发货，含 FIFO 扣减冻结库存、成本计算、利润核算
 */
@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name)

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ShipmentItem)
    private readonly itemRepo: Repository<ShipmentItem>,
    @InjectRepository(ShipmentItemBatch)
    private readonly batchRepo: Repository<ShipmentItemBatch>,
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderItem)
    private readonly orderItemRepo: Repository<SalesOrderItem>,
    @InjectRepository(InventoryBatch)
    private readonly inventoryBatchRepo: Repository<InventoryBatch>,
    private readonly sequenceService: SequenceService,
    private readonly fifoService: FifoService,
    private readonly salesOrderService: SalesOrderService,
  ) {}

  /**
   * 创建发货单（8 步事务）⭐
   * 1. 校验订单状态
   * 2. 校验发货数量 ≤ 可发数量
   * 3. 创建发货单 + 明细
   * 4. FIFO 扣减冻结库存
   * 5. 写入发货批次明细
   * 6. 汇总成本、计算毛利
   * 7. 更新订单已发数量 + 重算三维状态
   * 8. 提交
   */
  async create(dto: CreateShipmentDto): Promise<Shipment> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('发货明细不能为空')
    }

    // 1. 校验订单状态
    const order = await this.orderRepo.findOne({
      where: { id: dto.orderId },
    })
    if (!order) throw new BadRequestException('订单不存在')
    if (order.status !== 1) throw new BadRequestException('订单已结束，无法发货')
    if (order.shipmentStatus === 3) {
      throw new BadRequestException('订单已全部发货，无法再次发货')
    }

    // 2. 校验每个明细的发货数量
    const orderItems = await this.orderItemRepo.find({
      where: { orderId: dto.orderId },
    })
    const orderItemMap = new Map(orderItems.map((oi) => [oi.id, oi]))

    for (const item of dto.items) {
      const orderItem = orderItemMap.get(item.orderItemId)
      if (!orderItem) {
        throw new BadRequestException(`订单明细 ${item.orderItemId} 不存在`)
      }
      const shipQty = parseFloat(item.quantity)
      if (shipQty <= 0) throw new BadRequestException('发货数量必须大于零')

      const remaining =
        parseFloat(orderItem.quantity) - parseFloat(orderItem.shippedQuantity)
      if (shipQty > remaining) {
        throw new BadRequestException(
          `发货数量 ${shipQty} 超过可发数量 ${remaining}`,
        )
      }
    }

    // 3. 生成发货单号并创建
    const shipmentNo = await this.sequenceService.generate('FH')

    const shipment = this.shipmentRepo.create({
      id: snowflake.nextId(),
      shipmentNo,
      orderId: dto.orderId,
      expressCompanyId: dto.expressCompanyId,
      trackingNo: dto.trackingNo,
      shipmentDate: new Date(dto.shipmentDate),
      status: 1,
      remark: dto.remark || null,
    })
    const savedShipment = await this.shipmentRepo.save(shipment)

    // 4-6. 遍历每个明细：创建明细 → FIFO 扣减 → 写批次 → 计算成本/利润
    for (const dtoItem of dto.items) {
      const orderItem = orderItemMap.get(dtoItem.orderItemId)!
      const shipQty = parseFloat(dtoItem.quantity)
      const salesAmount = shipQty * parseFloat(orderItem.unitPriceUsd)

      // 创建发货明细
      const shipmentItem = this.itemRepo.create({
        id: snowflake.nextId(),
        shipmentId: savedShipment.id,
        orderItemId: dtoItem.orderItemId,
        productId: orderItem.productId,
        quantity: dtoItem.quantity,
        salesUnitPrice: orderItem.unitPriceUsd,
        salesAmount: salesAmount.toFixed(2),
        totalCost: '0',
        grossProfit: '0',
      })
      const savedItem = await this.itemRepo.save(shipmentItem)

      // 4. FIFO 扣减冻结库存
      const fifoResult = await this.fifoService.deductFrozen(
        orderItem.productId,
        shipQty,
        savedShipment.id,
        2, // 销售发货
      )

      // 5. 写入发货批次明细
      for (const batch of fifoResult.items) {
        const itemBatch = this.batchRepo.create({
          id: snowflake.nextId(),
          shipmentItemId: savedItem.id,
          inventoryBatchId: batch.batchId,
          quantity: String(batch.quantity),
          unitCost: batch.unitCost,
          totalCost: batch.totalCost,
        })
        await this.batchRepo.save(itemBatch)
      }

      // 6. 汇总成本、计算毛利
      const totalCost = parseFloat(fifoResult.totalCost)
      savedItem.totalCost = fifoResult.totalCost
      savedItem.grossProfit = (salesAmount - totalCost).toFixed(2)
      await this.itemRepo.save(savedItem)
    }

    // 7. 更新订单已发数量 + 重算三维状态
    for (const dtoItem of dto.items) {
      await this.salesOrderService.updateShippedQuantity(
        dto.orderId,
        dtoItem.orderItemId,
        parseFloat(dtoItem.quantity),
      )
    }

    this.logger.log(`发货完成: ${shipmentNo}, 订单: ${order.orderNo}`)
    return savedShipment
  }

  /**
   * 发货预览
   * 返回订单的可发明细 + FIFO 预估批次消耗
   */
  async preview(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } })
    if (!order) throw new BadRequestException('订单不存在')

    const orderItems = await this.orderItemRepo.find({
      where: { orderId },
    })

    const previewItems = []
    for (const item of orderItems) {
      const remaining =
        parseFloat(item.quantity) - parseFloat(item.shippedQuantity)
      if (remaining <= 0) continue

      // 查询预估 FIFO 批次
      const batches = await this.inventoryBatchRepo
        .createQueryBuilder('b')
        .where('b.productId = :productId', { productId: item.productId })
        .andWhere('b.frozenQuantity > 0')
        .orderBy('b.inboundTime', 'ASC')
        .getMany()

      const batchPreview = []
      let need = remaining
      for (const batch of batches) {
        if (need <= 0) break
        const frozen = parseFloat(batch.frozenQuantity)
        const qty = Math.min(frozen, need)
        batchPreview.push({
          batchId: batch.id,
          batchNo: batch.batchNo,
          quantity: qty,
          unitCost: batch.unitCost,
          totalCost: (qty * parseFloat(batch.unitCost)).toFixed(2),
        })
        need -= qty
      }

      previewItems.push({
        orderItemId: item.id,
        productId: item.productId,
        unitPriceUsd: item.unitPriceUsd,
        remainingQuantity: remaining,
        batches: batchPreview,
        estimatedCost: batchPreview
          .reduce((s, b) => s + parseFloat(b.totalCost), 0)
          .toFixed(2),
      })
    }

    return {
      orderId,
      orderNo: order.orderNo,
      customerName: order.customerName,
      items: previewItems,
    }
  }

  /**
   * 查询发货单详情（聚合：主表 + 明细 + 批次）
   */
  async findOne(id: string) {
    const shipment = await this.shipmentRepo.findOne({ where: { id } })
    if (!shipment) throw new BadRequestException('发货单不存在')

    const items = await this.itemRepo.find({ where: { shipmentId: id } })

    // 查询每个明细的批次
    const itemsWithBatches = await Promise.all(
      items.map(async (item) => {
        const batches = await this.batchRepo.find({
          where: { shipmentItemId: item.id },
        })
        return { ...item, batches }
      }),
    )

    return { ...shipment, items: itemsWithBatches }
  }

  /**
   * 分页查询发货单列表
   */
  async findAll(query: QueryShipmentDto) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const qb = this.shipmentRepo.createQueryBuilder('s')

    if (query.shipmentNo) {
      qb.andWhere('s.shipmentNo LIKE :no', { no: `%${query.shipmentNo}%` })
    }
    if (query.orderId) {
      qb.andWhere('s.orderId = :orderId', { orderId: query.orderId })
    }
    if (query.expressCompanyId) {
      qb.andWhere('s.expressCompanyId = :expressCompanyId', {
        expressCompanyId: query.expressCompanyId,
      })
    }
    if (query.trackingNo) {
      qb.andWhere('s.trackingNo LIKE :trackingNo', {
        trackingNo: `%${query.trackingNo}%`,
      })
    }
    if (query.startDate) {
      qb.andWhere('s.shipmentDate >= :startDate', { startDate: query.startDate })
    }
    if (query.endDate) {
      qb.andWhere('s.shipmentDate <= :endDate', { endDate: query.endDate })
    }

    qb.orderBy('s.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }
}
