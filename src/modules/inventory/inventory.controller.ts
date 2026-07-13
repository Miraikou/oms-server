import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from './entities/inventory.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { QueryInventoryDto } from './dto/inventory-adjustment.dto';

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
  @ApiOperation({ summary: '库存列表（分页，从批次实时汇总）' })
  async findAll(@Query() query: QueryInventoryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.inventoryRepo.createQueryBuilder('inv');

    qb.orderBy('inv.updatedTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();

    // 从批次表实时汇总，覆盖汇总表的缓存值（按 productId + productModelId 分组）
    if (list.length > 0) {
      const productIds = list.map((inv) => inv.productId);
      const batchSums = await this.batchRepo
        .createQueryBuilder('b')
        .select('b.productId', 'productId')
        .addSelect('b.productModelId', 'productModelId')
        .addSelect('COALESCE(SUM(b.availableQuantity), 0)', 'availableQuantity')
        .addSelect('COALESCE(SUM(b.frozenQuantity), 0)', 'frozenQuantity')
        .addSelect('COALESCE(SUM(b.stockQuantity), 0)', 'stockQuantity')
        .where('b.productId IN (:...productIds)', { productIds })
        .andWhere('b.status = 1')
        .groupBy('b.productId')
        .addGroupBy('b.productModelId')
        .getRawMany<{
          productId: string;
          productModelId: string | null;
          availableQuantity: string;
          frozenQuantity: string;
          stockQuantity: string;
        }>();

      const sumMap = new Map<string, { availableQuantity: string; frozenQuantity: string; stockQuantity: string }>();
      for (const row of batchSums) {
        const key = row.productModelId
          ? `${row.productId}::${row.productModelId}`
          : `${row.productId}::`;
        sumMap.set(key, {
          availableQuantity: row.availableQuantity,
          frozenQuantity: row.frozenQuantity,
          stockQuantity: row.stockQuantity,
        });
      }

      for (const inv of list) {
        const key = inv.productModelId
          ? `${inv.productId}::${inv.productModelId}`
          : `${inv.productId}::`;
        const sum = sumMap.get(key);
        if (sum) {
          inv.availableQuantity = sum.availableQuantity;
          inv.frozenQuantity = sum.frozenQuantity;
          inv.stockQuantity = sum.stockQuantity;
        } else {
          inv.availableQuantity = '0';
          inv.frozenQuantity = '0';
          inv.stockQuantity = '0';
        }
      }
    }

    return { list, total, page, pageSize };
  }

  @Get('warnings')
  @ApiOperation({ summary: '库存预警（低库存商品）' })
  async getWarnings() {
    const items = await this.inventoryRepo
      .createQueryBuilder('inv')
      .where('inv.availableQuantity <= inv.minimumStock')
      .andWhere('inv.minimumStock > 0')
      .orderBy('inv.availableQuantity', 'ASC')
      .getMany();
    return items;
  }

  @Get(':id')
  @ApiOperation({ summary: '库存详情' })
  async findOne(@Param('id') id: string) {
    return this.inventoryRepo.findOne({ where: { id } });
  }

  @Get('product/:productId/batches')
  @ApiOperation({ summary: '商品批次列表' })
  async getBatches(@Param('productId') productId: string) {
    const batches = await this.batchRepo.find({
      where: { productId },
      order: { inboundTime: 'ASC' },
    });

    // 查询关联的采购单币种
    const receiptItemIds = batches
      .map((b) => b.receiptItemId)
      .filter((id): id is string => id !== null);
    const currencies: Record<string, string> = {};
    if (receiptItemIds.length > 0) {
      const rows = await this.batchRepo.manager
        .createQueryBuilder()
        .select('pri.id', 'id')
        .addSelect('po.currency', 'currency')
        .from('purchase_receipt_item', 'pri')
        .leftJoin('purchase_receipt', 'pr', 'pr.id = pri.receipt_id')
        .leftJoin('purchase_order', 'po', 'po.id = pr.purchase_order_id')
        .where('pri.id IN (:...ids)', { ids: receiptItemIds })
        .getRawMany<{ id: string; currency: string }>();
      for (const row of rows) {
        currencies[row.id] = row.currency;
      }
    }

    return batches.map((b) => ({
      ...b,
      currency: (b.receiptItemId && currencies[b.receiptItemId]) || undefined,
    }));
  }

  @Get('product/:productId/flows')
  @ApiOperation({ summary: '商品库存流水' })
  async getFlows(
    @Param('productId') productId: string,
    @Query() query: { page?: number; pageSize?: number },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const [list, total] = await this.flowRepo.findAndCount({
      where: { productId },
      order: { createdTime: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  @Post('consistency-check')
  @ApiOperation({ summary: '库存一致性校验' })
  async consistencyCheck(@Body() body: { productId?: string }) {
    const results: Array<{
      productId: string;
      productModelId: string | null;
      summaryAvailable: string;
      batchSumAvailable: string;
      match: boolean;
    }> = [];

    const where = body.productId ? { productId: body.productId } : {};
    const inventories = await this.inventoryRepo.find({ where });

    for (const inv of inventories) {
      const batchSum: { total: string } | undefined = await this.batchRepo
        .createQueryBuilder('b')
        .select('SUM(b.availableQuantity)', 'total')
        .where('b.productId = :productId', { productId: inv.productId })
        .andWhere('b.status = :status', { status: 1 })
        .andWhere(
          inv.productModelId
            ? 'b.productModelId = :productModelId'
            : 'b.productModelId IS NULL',
          inv.productModelId ? { productModelId: inv.productModelId } : {},
        )
        .getRawOne();

      const batchTotal = batchSum?.total || '0';
      results.push({
        productId: inv.productId,
        productModelId: inv.productModelId || null,
        summaryAvailable: inv.availableQuantity,
        batchSumAvailable: String(parseFloat(batchTotal)),
        match:
          Math.abs(parseFloat(inv.availableQuantity) - parseFloat(batchTotal)) <
          0.0001,
      });
    }

    return {
      total: results.length,
      matched: results.filter((r) => r.match).length,
      mismatched: results.filter((r) => !r.match),
    };
  }

  @Post('reconcile')
  @ApiOperation({ summary: '库存校准（从批次重算汇总）' })
  async reconcile(@Body() body: { productId?: string }) {
    const results: Array<{
      productId: string;
      beforeAvailable: string;
      afterAvailable: string;
      beforeFrozen: string;
      afterFrozen: string;
      beforeStock: string;
      afterStock: string;
      adjusted: boolean;
    }> = [];

    const where = body?.productId ? { productId: body.productId } : {};
    const inventories = await this.inventoryRepo.find({ where });

    for (const inv of inventories) {
      // 从批次表汇总有效批次的数量（按 productId + productModelId 匹配）
      const batchSum = await this.batchRepo
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.availableQuantity), 0)', 'available')
        .addSelect('COALESCE(SUM(b.frozenQuantity), 0)', 'frozen')
        .addSelect('COALESCE(SUM(b.stockQuantity), 0)', 'stock')
        .where('b.productId = :productId', { productId: inv.productId })
        .andWhere('b.status = 1')
        .andWhere(
          inv.productModelId
            ? 'b.productModelId = :productModelId'
            : 'b.productModelId IS NULL',
          inv.productModelId ? { productModelId: inv.productModelId } : {},
        )
        .getRawOne<{ available: string; frozen: string; stock: string }>();

      const sumAvailable = batchSum?.available || '0';
      const sumFrozen = batchSum?.frozen || '0';
      const sumStock = batchSum?.stock || '0';

      const beforeAvailable = inv.availableQuantity;
      const beforeFrozen = inv.frozenQuantity;
      const beforeStock = inv.stockQuantity;

      const diff =
        Math.abs(parseFloat(beforeAvailable) - parseFloat(sumAvailable)) +
        Math.abs(parseFloat(beforeFrozen) - parseFloat(sumFrozen)) +
        Math.abs(parseFloat(beforeStock) - parseFloat(sumStock));

      if (diff > 0.0001) {
        inv.availableQuantity = parseFloat(sumAvailable).toFixed(4);
        inv.frozenQuantity = parseFloat(sumFrozen).toFixed(4);
        inv.stockQuantity = parseFloat(sumStock).toFixed(4);
        inv.version += 1;
        await this.inventoryRepo.save(inv);

        results.push({
          productId: inv.productId,
          beforeAvailable,
          afterAvailable: inv.availableQuantity,
          beforeFrozen,
          afterFrozen: inv.frozenQuantity,
          beforeStock,
          afterStock: inv.stockQuantity,
          adjusted: true,
        });
      } else {
        results.push({
          productId: inv.productId,
          beforeAvailable,
          afterAvailable: beforeAvailable,
          beforeFrozen,
          afterFrozen: beforeFrozen,
          beforeStock,
          afterStock: beforeStock,
          adjusted: false,
        });
      }
    }

    return {
      total: results.length,
      adjusted: results.filter((r) => r.adjusted).length,
      details: results,
    };
  }
}
