import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { InventoryFlow } from './entities/inventory-flow.entity'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

@ApiTags('库存流水')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory-flows')
export class InventoryFlowController {
  constructor(
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
  ) {}

  @Get()
  @ApiOperation({ summary: '流水列表（分页）' })
  async findAll(@Query() query: { productId?: string; businessType?: number; page?: number; pageSize?: number }) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const qb = this.flowRepo.createQueryBuilder('f')
    if (query.productId) {
      qb.andWhere('f.productId = :productId', { productId: query.productId })
    }
    if (query.businessType !== undefined) {
      qb.andWhere('f.businessType = :businessType', { businessType: query.businessType })
    }

    qb.orderBy('f.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }

  @Get(':id')
  @ApiOperation({ summary: '流水详情' })
  async findOne(@Param('id') id: string) {
    return this.flowRepo.findOne({ where: { id } })
  }
}
