import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('库存流水')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory-flows')
export class InventoryFlowController {
  constructor(
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
    @InjectRepository(InventoryAdjustment)
    private readonly adjustmentRepo: Repository<InventoryAdjustment>,
  ) {}

  @Get()
  @ApiOperation({ summary: '流水列表（分页）' })
  async findAll(
    @Query()
    query: {
      productId?: string;
      businessType?: number;
      batchId?: string;
      batchNo?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.flowRepo
      .createQueryBuilder('f')
      .leftJoin('inventory_batch', 'ib', 'ib.id = f.batchId')
      .leftJoin('purchase_receipt_item', 'pri', 'pri.id = ib.receipt_item_id')
      .leftJoin('purchase_receipt', 'pr', 'pr.id = pri.receipt_id')
      .leftJoin('purchase_order', 'po', 'po.id = pr.purchase_order_id')
      .addSelect('ib.batch_no', 'batchNo')
      .addSelect('po.currency', 'currency');

    if (query.productId) {
      qb.andWhere('f.productId = :productId', { productId: query.productId });
    }
    if (typeof query.businessType === 'number') {
      qb.andWhere('f.businessType = :businessType', {
        businessType: query.businessType,
      });
    }
    if (query.batchId) {
      qb.andWhere('f.batchId = :batchId', { batchId: query.batchId });
    }
    if (query.batchNo) {
      qb.andWhere('ib.batch_no = :batchNo', { batchNo: query.batchNo });
    }

    qb.orderBy('f.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const { entities: list, raw: rawList } = await qb.getRawAndEntities();
    const total = await qb.getCount();

    // 从 raw 结果中提取 JOIN 字段
    const rawMap = new Map<string, { batchNo: string; currency: string }>();
    for (const raw of rawList) {
      rawMap.set(raw.f_id, {
        batchNo: raw.batchNo,
        currency: raw.currency,
      });
    }

    // 查询关联的调整单号（businessType=5 时为库存调整）
    const adjustmentIds = [
      ...new Set(
        list.filter((f) => f.businessType === 5).map((f) => f.businessId),
      ),
    ];
    const adjustmentNos: Record<string, string> = {};
    if (adjustmentIds.length > 0) {
      const adjustments = await this.adjustmentRepo
        .createQueryBuilder('a')
        .select(['a.id', 'a.adjustmentNo'])
        .where('a.id IN (:...ids)', { ids: adjustmentIds })
        .getMany();
      for (const a of adjustments) {
        adjustmentNos[a.id] = a.adjustmentNo;
      }
    }

    const enrichedList = list.map((f) => {
      const info = rawMap.get(f.id);
      return {
        ...f,
        batchNo: info?.batchNo || undefined,
        currency: info?.currency || undefined,
        adjustmentNo:
          f.businessType === 5
            ? adjustmentNos[f.businessId] || undefined
            : undefined,
      };
    });

    return { list: enrichedList, total, page, pageSize };
  }

  @Get(':id')
  @ApiOperation({ summary: '流水详情' })
  async findOne(@Param('id') id: string) {
    return this.flowRepo.findOne({ where: { id } });
  }
}
