import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
import { InventoryAdjustment } from './entities/inventory-adjustment.entity'
import { InventoryAdjustmentItem } from './entities/inventory-adjustment-item.entity'
import { Inventory } from './entities/inventory.entity'
import { InventoryBatch } from './entities/inventory-batch.entity'
import { InventoryFlow } from './entities/inventory-flow.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { FifoService } from './services/fifo.service'
import { snowflake } from '@/common/utils/snowflake'
import type { CreateInventoryAdjustmentDto, QueryInventoryAdjustmentDto } from './dto/inventory-adjustment.dto'

/**
 * 库存调整服务
 * 支持指定批次调整和自动调整（增加生成新批次，减少按 FIFO 扣减）
 */
@Injectable()
export class InventoryAdjustmentService {
  private readonly logger = new Logger(InventoryAdjustmentService.name)

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
    private readonly sequenceService: SequenceService,
    private readonly fifoService: FifoService,
  ) {}

  /** 创建库存调整 */
  async create(dto: CreateInventoryAdjustmentDto): Promise<InventoryAdjustment> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('调整明细不能为空')
    }

    const adjustmentNo = await this.sequenceService.generate('KC')

    const adjustment = this.adjustmentRepo.create({
      id: snowflake.nextId(),
      adjustmentNo,
      adjustmentDate: new Date(),
      reason: dto.reason,
      remark: dto.remark || null,
    })
    const saved = await this.adjustmentRepo.save(adjustment)

    for (const item of dto.items) {
      const changeQty = parseFloat(item.changeQuantity)
      if (changeQty === 0) throw new BadRequestException('调整数量不能为零')

      // 保存调整明细
      const adjItem = this.adjustmentItemRepo.create({
        id: snowflake.nextId(),
        adjustmentId: saved.id,
        productId: item.productId,
        batchId: item.batchId || null,
        changeQuantity: item.changeQuantity,
      })
      await this.adjustmentItemRepo.save(adjItem)

      if (changeQty > 0) {
        // 增加库存
        if (item.batchId) {
          // 指定批次：直接增加该批次
          const batch = await this.batchRepo.findOne({ where: { id: item.batchId } })
          if (!batch) throw new BadRequestException('指定批次不存在')

          const beforeAvailable = batch.availableQuantity
          batch.availableQuantity = (parseFloat(batch.availableQuantity) + changeQty).toFixed(4)
          batch.stockQuantity = (parseFloat(batch.stockQuantity) + changeQty).toFixed(4)
          batch.originalQuantity = (parseFloat(batch.originalQuantity) + changeQty).toFixed(4)
          if (batch.status === 2) batch.status = 1
          batch.version += 1
          await this.batchRepo.save(batch)

          // 更新库存汇总
          await this.addToInventory(item.productId, changeQty)

          // 写流水
          await this.writeAdjustmentFlow(
            batch.id, item.productId, saved.id,
            item.changeQuantity, batch.unitCost,
            beforeAvailable, batch.availableQuantity,
          )
        } else {
          // 未指定批次：生成新调整批次
          const batchNo = await this.sequenceService.generate('BT')
          const batch = this.batchRepo.create({
            id: snowflake.nextId(),
            productId: item.productId,
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
          })
          const savedBatch = await this.batchRepo.save(batch)

          await this.addToInventory(item.productId, changeQty)

          await this.writeAdjustmentFlow(
            savedBatch.id, item.productId, saved.id,
            item.changeQuantity, '0',
            '0', item.changeQuantity,
          )
        }
      } else {
        // 减少库存：调用 FIFO 引擎扣减
        const absQty = Math.abs(changeQty)
        await this.fifoService.consume(item.productId, absQty, saved.id, 5) // businessType=5 库存调整
      }
    }

    this.logger.log(`库存调整完成: ${adjustmentNo}`)
    return saved
  }

  /** 查询列表 */
  async findAll(query: QueryInventoryAdjustmentDto) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const [list, total] = await this.adjustmentRepo.findAndCount({
      order: { createdTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return { list, total, page, pageSize }
  }

  /** 查询详情 */
  async findOne(id: string) {
    const adjustment = await this.adjustmentRepo.findOne({ where: { id } })
    if (!adjustment) throw new BadRequestException('调整单不存在')
    const items = await this.adjustmentItemRepo.find({ where: { adjustmentId: id } })
    return { ...adjustment, items }
  }

  /** 辅助：增加库存汇总 */
  private async addToInventory(productId: string, delta: number): Promise<void> {
    let inv = await this.inventoryRepo.findOne({ where: { productId } })
    if (!inv) {
      inv = this.inventoryRepo.create({
        id: snowflake.nextId(),
        productId,
        availableQuantity: String(delta),
        frozenQuantity: '0',
        stockQuantity: String(delta),
        minimumStock: '0',
        version: 0,
      })
    } else {
      inv.availableQuantity = (parseFloat(inv.availableQuantity) + delta).toFixed(4)
      inv.stockQuantity = (parseFloat(inv.stockQuantity) + delta).toFixed(4)
      inv.version += 1
    }
    await this.inventoryRepo.save(inv)
  }

  /** 辅助：写调整流水 */
  private async writeAdjustmentFlow(
    batchId: string, productId: string, businessId: string,
    quantity: string, unitCost: string,
    beforeAvailable: string, afterAvailable: string,
  ): Promise<void> {
    const inv = await this.inventoryRepo.findOne({ where: { productId } })
    const totalCost = (parseFloat(quantity) * parseFloat(unitCost)).toFixed(2)

    await this.flowRepo.save(this.flowRepo.create({
      id: snowflake.nextId(),
      batchId,
      productId,
      businessType: 5, // 库存调整
      businessId,
      changeType: parseFloat(quantity) > 0 ? 5 : 2,
      quantity: String(Math.abs(parseFloat(quantity))),
      unitCost,
      totalCost,
      beforeAvailable,
      afterAvailable,
      beforeFrozen: inv?.frozenQuantity || '0',
      afterFrozen: inv?.frozenQuantity || '0',
    }))
  }
}
