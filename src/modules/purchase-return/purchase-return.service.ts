import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull } from 'typeorm';
import { PurchaseReturn } from './entities/purchase-return.entity';
import { PurchaseReturnItem } from './entities/purchase-return-item.entity';
import { PurchaseOrder } from '@/modules/purchase/entities/purchase-order.entity';
import { PurchaseOrderItem } from '@/modules/purchase/entities/purchase-order-item.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { PurchaseOrderService } from '@/modules/purchase/purchase-order.service';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { FifoService } from '@/modules/inventory/services/fifo.service';
import {
  StockAlertService,
  type StockDecreaseItem,
} from '@/modules/inventory/services/stock-alert.service';
import { snowflake } from '@/common/utils/snowflake';
import type {
  CreatePurchaseReturnDto,
  QueryPurchaseReturnDto,
} from './dto/purchase-return.dto';

/**
 * 采购退货服务
 * 事务：校验采购单 → 校验可退数量 → 创建退货单 → FIFO 扣减库存 → 更新退货数量 → 更新退货状态
 */
@Injectable()
export class PurchaseReturnService {
  private readonly logger = new Logger(PurchaseReturnService.name);

  constructor(
    @InjectRepository(PurchaseReturn)
    private readonly returnRepo: Repository<PurchaseReturn>,
    @InjectRepository(PurchaseReturnItem)
    private readonly returnItemRepo: Repository<PurchaseReturnItem>,
    @InjectRepository(PurchaseOrder)
    private readonly orderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderItem)
    private readonly orderItemRepo: Repository<PurchaseOrderItem>,
    private readonly sequenceService: SequenceService,
    private readonly fifoService: FifoService,
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly dataSource: DataSource,
    private readonly stockAlertService: StockAlertService,
  ) {}

  /**
   * 创建采购退货单
   */
  async create(dto: CreatePurchaseReturnDto): Promise<PurchaseReturn> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    const decreasedItems: StockDecreaseItem[] = [];
    const result = await this.dataSource.transaction(async (manager) => {
      // 1. 校验采购单已入库
      const order = await manager.findOne(PurchaseOrder, {
        where: { id: dto.purchaseOrderId },
      });
      if (!order) throw new BadRequestException('采购单不存在');
      if (order.status < 2) {
        throw new BadRequestException('采购单尚未入库，无法退货');
      }

      // 2. 校验可退数量（采购单维度 + 库存可用量维度）
      const orderItems = new Map<string, PurchaseOrderItem>();
      const inventoryCache = new Map<string, number>();
      for (const item of dto.items) {
        const orderItem = await manager.findOne(PurchaseOrderItem, {
          where: { id: item.purchaseOrderItemId },
        });
        if (!orderItem) {
          throw new BadRequestException(
            `采购明细 ${item.purchaseOrderItemId} 不存在`,
          );
        }
        orderItems.set(item.purchaseOrderItemId, orderItem);

        const returnQty = parseFloat(item.quantity);
        if (returnQty <= 0) throw new BadRequestException('退货数量必须大于零');

        const received = parseFloat(orderItem.receivedQuantity);
        const returned = parseFloat(orderItem.returnedQuantity);
        const poReturnable = received - returned;

        // 查询库存可用量（缓存，随校验扣减）
        const invKey = `${orderItem.productId}__${orderItem.productModelId || 'NULL'}`;
        let invAvailable = inventoryCache.get(invKey);
        if (invAvailable === undefined) {
          const inv = await manager.findOne(Inventory, {
            where: orderItem.productModelId
              ? { productId: orderItem.productId, productModelId: orderItem.productModelId }
              : { productId: orderItem.productId, productModelId: IsNull() },
          });
          invAvailable = inv ? parseFloat(inv.availableQuantity) : 0;
          inventoryCache.set(invKey, invAvailable);
        }

        const returnable = Math.max(0, Math.min(poReturnable, invAvailable));
        if (returnQty > returnable) {
          throw new BadRequestException(
            `退货数量 ${returnQty} 超过可退数量 ${returnable}`,
          );
        }
        // 扣减已校验的可用量，同商品同型号后续明细看到递减的可用量
        inventoryCache.set(invKey, invAvailable - returnQty);
      }

      // 3. 创建退货单 + 明细
      const returnNo = await this.sequenceService.generate('PT');
      const purchaseReturn = manager.create(PurchaseReturn, {
        id: snowflake.nextId(),
        returnNo,
        purchaseOrderId: dto.purchaseOrderId,
        returnDate: new Date(dto.returnDate),
        reason: dto.reason || null,
        remark: dto.remark || null,
      });
      const savedReturn = await manager.save(purchaseReturn);

      for (const dtoItem of dto.items) {
        const orderItem = await manager.findOne(PurchaseOrderItem, {
          where: { id: dtoItem.purchaseOrderItemId },
        });
        const returnItem = manager.create(PurchaseReturnItem, {
          id: snowflake.nextId(),
          purchaseReturnId: savedReturn.id,
          purchaseOrderItemId: dtoItem.purchaseOrderItemId,
          productId: orderItem!.productId,
          productModelId: orderItem!.productModelId,
          quantity: dtoItem.quantity,
        });
        await manager.save(returnItem);

        // 4. 扣减库存（传入 manager 保证事务原子性）
        await this.fifoService.consume(
          orderItem!.productId,
          orderItem!.productModelId,
          parseFloat(dtoItem.quantity),
          savedReturn.id,
          4, // 采购退货
          manager,
        );
        decreasedItems.push({
          productId: orderItem!.productId,
          productModelId: orderItem!.productModelId || null,
          decreasedQty: parseFloat(dtoItem.quantity),
        });

        // 5. 更新采购明细退货数量
        orderItem!.returnedQuantity = (
          parseFloat(orderItem!.returnedQuantity) + parseFloat(dtoItem.quantity)
        ).toFixed(4);
        await manager.save(orderItem!);
      }

      // 6. 更新采购单退货状态（传入 manager 保证事务原子性）
      await this.purchaseOrderService.recalculateReturnStatus(
        dto.purchaseOrderId,
        manager,
      );

      this.logger.log(`采购退货完成: ${returnNo}, 采购单: ${order.purchaseNo}`);
      return savedReturn;
    });

    // 事务提交后：库存预警检测（fire-and-forget，不影响业务流程）
    void this.stockAlertService.checkAndNotify(decreasedItems);

    return result;
  }

  /**
   * 查询退货详情（含明细）
   */
  async findOne(id: string) {
    const ret = await this.returnRepo.findOne({ where: { id } });
    if (!ret) throw new BadRequestException('退货单不存在');
    const items = await this.returnItemRepo.find({
      where: { purchaseReturnId: id },
    });

    // 批量查询商品名称
    const productIds = items
      .map((i) => i.productId)
      .filter((pid): pid is string => !!pid);
    const productNameMap = new Map<string, string>();
    if (productIds.length > 0) {
      const products = await this.dataSource
        .createQueryBuilder()
        .select('p.id, p.product_name')
        .from(Product, 'p')
        .where('p.id IN (:...ids)', { ids: productIds })
        .getRawMany();
      for (const p of products) productNameMap.set(p.id, p.product_name);
    }

    // 批量查询型号名称
    const modelIds = items
      .map((i) => i.productModelId)
      .filter((mid): mid is string => !!mid);
    const modelNameMap = new Map<string, string>();
    if (modelIds.length > 0) {
      const models = await this.dataSource
        .createQueryBuilder()
        .select('m.id, m.model_name')
        .from(ProductModel, 'm')
        .where('m.id IN (:...ids)', { ids: modelIds })
        .getRawMany();
      for (const m of models) modelNameMap.set(m.id, m.model_name);
    }

    const enrichedItems = items.map((item) => ({
      ...item,
      productName: productNameMap.get(item.productId) || undefined,
      modelName: item.productModelId
        ? modelNameMap.get(item.productModelId)
        : undefined,
    }));

    return { ...ret, items: enrichedItems };
  }

  /**
   * 分页查询退货列表
   */
  async findAll(query: QueryPurchaseReturnDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.returnRepo
      .createQueryBuilder('r')
      .leftJoin(PurchaseOrder, 'po', 'po.id = r.purchase_order_id')
      .addSelect('po.purchase_no', 'purchaseNo');

    if (query.returnNo) {
      qb.andWhere('r.returnNo LIKE :no', { no: `%${query.returnNo}%` });
    }
    if (query.purchaseOrderId) {
      qb.andWhere('r.purchaseOrderId = :purchaseOrderId', {
        purchaseOrderId: query.purchaseOrderId,
      });
    }
    if (query.purchaseNo) {
      qb.andWhere('po.purchase_no LIKE :purchaseNo', {
        purchaseNo: query.purchaseNo,
      });
    }
    if (query.startDate) {
      qb.andWhere('r.returnDate >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('r.returnDate <= :endDate', { endDate: query.endDate });
    }

    const sortField = query.sortField || 'createdTime';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`r.${sortField}`, sortOrder)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const { entities, raw: rawResults } = await qb.getRawAndEntities();
    const list = entities.map((entity, index) => ({
      ...entity,
      purchaseNo: rawResults[index]?.purchaseNo || null,
    }));

    return { list, total: await qb.getCount(), page, pageSize };
  }
}
