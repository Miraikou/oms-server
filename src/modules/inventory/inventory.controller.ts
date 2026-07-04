import { Controller, Get, Post, Param, Query, UseGuards, Body } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Inventory } from './entities/inventory.entity'
import { InventoryBatch } from './entities/inventory-batch.entity'
import { InventoryFlow } from './entities/inventory-flow.entity'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import type { QueryInventoryDto, QueryInventoryFlowDto } from './dto/inventory-adjustment.dto'

@ApiTags('库存管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventories')
export class InventoryController {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventoryBatch)
    private readonly batchRepo: Repository<InventoryBatch>,
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
  ) {}

  @Get()
  @ApiOperation({ summary: '库存列表（分页）' })
  async findAll(@Query() query: QueryInventoryDto) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const qb = this.inventoryRepo.createQueryBuilder('inv')

    qb.orderBy('inv.updatedTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }

  @Get('warnings')
  @ApiOperation({ summary: '库存预警（低库存商品）' })
  async getWarnings() {
    const items = await this.inventoryRepo
      .createQueryBuilder('inv')
      .where('inv.availableQuantity <= inv.minimumStock')
      .andWhere('inv.minimumStock > 0')
      .orderBy('inv.availableQuantity', 'ASC')
      .getMany()
    return items
  }

  @Get(':id')
  @ApiOperation({ summary: '库存详情' })
  async findOne(@Param('id') id: string) {
    return this.inventoryRepo.findOne({ where: { id } })
  }

  @Get('product/:productId/batches')
  @ApiOperation({ summary: '商品批次列表' })
  async getBatches(@Param('productId') productId: string) {
    return this.batchRepo.find({
      where: { productId },
      order: { inboundTime: 'ASC' },
    })
  }

  @Get('product/:productId/flows')
  @ApiOperation({ summary: '商品库存流水' })
  async getFlows(@Param('productId') productId: string, @Query() query: { page?: number; pageSize?: number }) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const [list, total] = await this.flowRepo.findAndCount({
      where: { productId },
      order: { createdTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return { list, total, page, pageSize }
  }

  @Post('consistency-check')
  @ApiOperation({ summary: '库存一致性校验' })
  async consistencyCheck(@Body() body: { productId?: string }) {
    const results: Array<{
      productId: string
      summaryAvailable: string
      batchSumAvailable: string
      match: boolean
    }> = []

    const where = body.productId ? { productId: body.productId } : {}
    const inventories = await this.inventoryRepo.find({ where })

    for (const inv of inventories) {
      const batchSum = await this.batchRepo
        .createQueryBuilder('b')
        .select('SUM(b.availableQuantity)', 'total')
        .where('b.productId = :productId', { productId: inv.productId })
        .andWhere('b.status = 1')
        .getRawOne()

      const batchTotal = batchSum?.total || '0'
      results.push({
        productId: inv.productId,
        summaryAvailable: inv.availableQuantity,
        batchSumAvailable: String(parseFloat(batchTotal)),
        match: Math.abs(parseFloat(inv.availableQuantity) - parseFloat(batchTotal)) < 0.0001,
      })
    }

    return {
      total: results.length,
      matched: results.filter((r) => r.match).length,
      mismatched: results.filter((r) => !r.match),
    }
  }
}
