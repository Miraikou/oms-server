import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

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
  async findAll(
    @Query()
    query: {
      productId?: string;
      businessType?: number;
      batchId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.flowRepo.createQueryBuilder('f');
    if (query.productId) {
      qb.andWhere('f.productId = :productId', { productId: query.productId });
    }
    if (typeof query.businessType === 'number') {
      qb.andWhere('f.businessType = :businessType', {
        businessType: query.businessType,
      });
    }
    if (query.batchId) {
      qb.andWhere('f.batchId = :batchId', {
        batchId: query.batchId,
      });
    }

    qb.orderBy('f.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();

    // 查询关联的采购单币种
    const batchIds = [...new Set(list.map((f) => f.batchId))];
    const currencies: Record<string, string> = {};
    if (batchIds.length > 0) {
      const rows = await this.flowRepo.manager
        .createQueryBuilder()
        .select('ib.id', 'batchId')
        .addSelect('po.currency', 'currency')
        .from('inventory_batch', 'ib')
        .leftJoin('purchase_receipt_item', 'pri', 'pri.id = ib.receipt_item_id')
        .leftJoin('purchase_receipt', 'pr', 'pr.id = pri.receipt_id')
        .leftJoin('purchase_order', 'po', 'po.id = pr.purchase_order_id')
        .where('ib.id IN (:...ids)', { ids: batchIds })
        .getRawMany<{ batchId: string; currency: string }>();
      for (const row of rows) {
        currencies[row.batchId] = row.currency;
      }
    }

    const enrichedList = list.map((f) => ({
      ...f,
      currency: currencies[f.batchId] || undefined,
    }));

    return { list: enrichedList, total, page, pageSize };
  }

  @Get(':id')
  @ApiOperation({ summary: '流水详情' })
  async findOne(@Param('id') id: string) {
    return this.flowRepo.findOne({ where: { id } });
  }
}
