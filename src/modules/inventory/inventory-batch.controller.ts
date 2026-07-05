import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('库存批次')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory-batches')
export class InventoryBatchController {
  constructor(
    @InjectRepository(InventoryBatch)
    private readonly batchRepo: Repository<InventoryBatch>,
  ) {}

  @Get()
  @ApiOperation({ summary: '批次列表（分页）' })
  async findAll(
    @Query()
    query: {
      productId?: string;
      status?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.batchRepo.createQueryBuilder('b');
    if (query.productId) {
      qb.andWhere('b.productId = :productId', { productId: query.productId });
    }
    if (query.status !== undefined) {
      qb.andWhere('b.status = :status', { status: query.status });
    }

    qb.orderBy('b.inboundTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  @Get(':id')
  @ApiOperation({ summary: '批次详情' })
  async findOne(@Param('id') id: string) {
    return this.batchRepo.findOne({ where: { id } });
  }
}
