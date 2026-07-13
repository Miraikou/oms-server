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
import { Repository, In } from 'typeorm';
import { Inventory } from './entities/inventory.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { QueryInventoryDto, QueryInventoryTreeDto } from './dto/inventory-adjustment.dto';

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

  @Get('tree')
  @ApiOperation({ summary: '库存树形列表（按商品分组，展开查看型号明细）' })
  async findTree(@Query() query: QueryInventoryTreeDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    // 1. 查询去重的商品列表（分页）
    const productQb = this.inventoryRepo
      .createQueryBuilder('inv')
      .select('inv.productId', 'productId')
      .addSelect('MAX(inv.updatedTime)', 'maxUpdatedTime')
      .groupBy('inv.productId')
      .orderBy('maxUpdatedTime', 'DESC');

    if (query.productId) {
      productQb.andWhere('inv.productId = :productId', { productId: query.productId });
    }

    const productResult = await productQb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getRawMany<{ productId: string }>();

    const productIds = productResult.map((r) => r.productId);
    if (productIds.length === 0) {
      return { list: [], total: 0, page, pageSize };
    }

    // 统计商品总数
    const countQb = this.inventoryRepo
      .createQueryBuilder('inv')
      .select('COUNT(DISTINCT inv.productId)', 'count');
    if (query.productId) {
      countQb.andWhere('inv.productId = :productId', { productId: query.productId });
    }
    const countResult = await countQb.getRawOne<{ count: string }>();
    const total = parseInt(countResult?.count || '0', 10);

    // 2. 查询这些商品下的所有库存记录（含型号）
    const invQb = this.inventoryRepo
      .createQueryBuilder('inv')
      .where('inv.productId IN (:...productIds)', { productIds });
    if (query.productId) {
      invQb.andWhere('inv.productId = :productId', { productId: query.productId });
    }
    const inventories = await invQb.getMany();

    // 3. 从批次表实时汇总（按 productId + productModelId）
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

    // 构建汇总 Map
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

    // 4. 按商品分组构建树形结构
    const productMap = new Map<string, {
      productId: string;
      availableQuantity: string;
      frozenQuantity: string;
      stockQuantity: string;
      updatedTime: string;
      children: Array<{
        productId: string;
        productModelId: string | null;
        availableQuantity: string;
        frozenQuantity: string;
        stockQuantity: string;
        updatedTime: string;
      }>;
    }>();

    for (const inv of inventories) {
      const key = inv.productModelId
        ? `${inv.productId}::${inv.productModelId}`
        : `${inv.productId}::`;
      const sum = sumMap.get(key);

      const availableQuantity = sum?.availableQuantity || '0';
      const frozenQuantity = sum?.frozenQuantity || '0';
      const stockQuantity = sum?.stockQuantity || '0';
      const updatedTime = inv.updatedTime instanceof Date
        ? inv.updatedTime.toISOString()
        : inv.updatedTime;

      const child = {
        productId: inv.productId,
        productModelId: inv.productModelId || null,
        availableQuantity,
        frozenQuantity,
        stockQuantity,
        updatedTime,
      };

      if (!productMap.has(inv.productId)) {
        productMap.set(inv.productId, {
          productId: inv.productId,
          availableQuantity: '0',
          frozenQuantity: '0',
          stockQuantity: '0',
          updatedTime,
          children: [],
        });
      }

      const product = productMap.get(inv.productId)!;
      product.children.push(child);

      // 累加商品级别的汇总
      product.availableQuantity = (
        parseFloat(product.availableQuantity) + parseFloat(availableQuantity)
      ).toFixed(4);
      product.frozenQuantity = (
        parseFloat(product.frozenQuantity) + parseFloat(frozenQuantity)
      ).toFixed(4);
      product.stockQuantity = (
        parseFloat(product.stockQuantity) + parseFloat(stockQuantity)
      ).toFixed(4);

      // 取最新的更新时间
      if (updatedTime > product.updatedTime) {
        product.updatedTime = updatedTime;
      }
    }

    // 按更新时间倒序排列
    const list = Array.from(productMap.values()).sort((a, b) =>
      b.updatedTime.localeCompare(a.updatedTime),
    );

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
  async getBatches(
    @Param('productId') productId: string,
    @Query('productModelId') productModelId?: string,
  ) {
    const where: Record<string, unknown> = { productId };
    if (productModelId) {
      where.productModelId = productModelId;
    }
    const batches = await this.batchRepo.find({
      where,
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

  @Get('product/:productId/batches-by-receipt')
  @ApiOperation({ summary: '按入库单分组的批次树形列表' })
  async getBatchesByReceipt(
    @Param('productId') productId: string,
    @Query('productModelId') productModelId?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') pageSizeStr?: string,
  ) {
    const page = Number(pageStr) || 1;
    const pageSize = Number(pageSizeStr) || 10;

    // 1. 查询去重的 receipt_id 列表（分页）
    const receiptQb = this.batchRepo
      .createQueryBuilder('b')
      .select('b.receiptItemId', 'receiptItemId')
      .where('b.productId = :productId', { productId });
    if (productModelId) {
      receiptQb.andWhere('b.productModelId = :productModelId', { productModelId });
    }
    receiptQb
      .andWhere('b.receiptItemId IS NOT NULL')
      .groupBy('b.receiptItemId')
      .orderBy('MIN(b.inboundTime)', 'DESC');

    const receiptResult = await receiptQb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getRawMany<{ receiptItemId: string }>();

    const receiptItemIds = receiptResult.map((r) => r.receiptItemId);

    // 统计有入库单的总数
    const countQb = this.batchRepo
      .createQueryBuilder('b')
      .select('COUNT(DISTINCT b.receiptItemId)', 'cnt')
      .where('b.productId = :productId', { productId })
      .andWhere('b.receiptItemId IS NOT NULL');
    if (productModelId) {
      countQb.andWhere('b.productModelId = :productModelId', { productModelId });
    }
    const countResult = await countQb.getRawOne<{ cnt: string }>();
    const total = parseInt(countResult?.cnt || '0', 10);

    // 2. 查询这些 receiptItemId 对应的所有批次
    let batches: InventoryBatch[] = [];
    if (receiptItemIds.length > 0) {
      batches = await this.batchRepo.find({
        where: { productId, receiptItemId: In(receiptItemIds) },
        order: { inboundTime: 'ASC' },
      });
      if (productModelId) {
        batches = batches.filter((b) => b.productModelId === productModelId);
      }
    }

    // 3. 查询入库单信息 + 币种（receipt_item → receipt → order）
    interface ReceiptInfo {
      receiptItemId: string;
      receiptId: string;
      receiptNo: string;
      receiptDate: string;
      currency: string;
    }
    let receiptInfoMap: ReceiptInfo[] = [];
    if (receiptItemIds.length > 0) {
      receiptInfoMap = await this.batchRepo.manager
        .createQueryBuilder()
        .select('pri.id', 'receiptItemId')
        .addSelect('pr.id', 'receiptId')
        .addSelect('pr.receipt_no', 'receiptNo')
        .addSelect('pr.receipt_date', 'receiptDate')
        .addSelect('po.currency', 'currency')
        .from('purchase_receipt_item', 'pri')
        .leftJoin('purchase_receipt', 'pr', 'pr.id = pri.receipt_id')
        .leftJoin('purchase_order', 'po', 'po.id = pr.purchase_order_id')
        .where('pri.id IN (:...ids)', { ids: receiptItemIds })
        .getRawMany<ReceiptInfo>();
    }

    // 4. 按 receiptItemId 分组
    const infoByRiId = new Map(receiptInfoMap.map((r) => [r.receiptItemId, r]));
    const groupMap = new Map<string, { info: ReceiptInfo; batches: InventoryBatch[] }>();
    for (const riId of receiptItemIds) {
      const info = infoByRiId.get(riId);
      if (info) {
        groupMap.set(riId, { info, batches: [] });
      }
    }
    for (const b of batches) {
      const g = b.receiptItemId ? groupMap.get(b.receiptItemId) : undefined;
      if (g) g.batches.push(b);
    }

    const list = Array.from(groupMap.values()).map(({ info, batches: bList }) => ({
      receiptId: info.receiptId,
      receiptNo: info.receiptNo,
      receiptDate: info.receiptDate,
      currency: info.currency || 'CNY',
      batchCount: bList.length,
      totalAvailable: bList.reduce((s, b) => s + parseFloat(b.availableQuantity), 0).toFixed(4),
      totalFrozen: bList.reduce((s, b) => s + parseFloat(b.frozenQuantity), 0).toFixed(4),
      totalStock: bList.reduce((s, b) => s + parseFloat(b.stockQuantity), 0).toFixed(4),
      children: bList,
    }));

    return { list, total, page, pageSize };
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
