import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, IsNull, In } from 'typeorm';
import { SalesOrder } from './entities/sales-order.entity';
import { SalesOrderItem } from './entities/sales-order-item.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { FifoService } from '@/modules/inventory/services/fifo.service';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity';
import { CommonContact } from '@/modules/common-contact/entities/common-contact.entity';
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity';
import { SalesOrderCost } from './entities/sales-order-cost.entity';
import { CostType } from '@/modules/cost-type/entities/cost-type.entity';
import { Payment } from '@/modules/payment/entities/payment.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { snowflake } from '@/common/utils/snowflake';
import { computeDualAmounts, computeDualUnitPrice } from '@/common/utils/dual-currency';
import type {
  CreateSalesOrderDto,
  UpdateSalesOrderDto,
  QuerySalesOrderDto,
} from './dto/sales-order.dto';
import { RateService } from '@/common/rate/rate.service';

/**
 * 订单服务 ⭐
 * 负责订单全生命周期管理：创建（含库存冻结）、修改、取消、三维状态计算
 */
@Injectable()
export class SalesOrderService {
  private readonly logger = new Logger(SalesOrderService.name);

  constructor(
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderItem)
    private readonly itemRepo: Repository<SalesOrderItem>,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(CommonContact)
    private readonly contactRepo: Repository<CommonContact>,
    @InjectRepository(ShipmentItem)
    private readonly shipmentItemRepo: Repository<ShipmentItem>,
    @InjectRepository(SalesOrderCost)
    private readonly costRepo: Repository<SalesOrderCost>,
    @InjectRepository(CostType)
    private readonly costTypeRepo: Repository<CostType>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductModel)
    private readonly productModelRepo: Repository<ProductModel>,
    private readonly sequenceService: SequenceService,
    private readonly fifoService: FifoService,
    private readonly dataSource: DataSource,
    private readonly rateService: RateService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 创建订单
   * 事务流程：生成订单号 → 创建主表+明细 → 检查库存 → 冻结库存 → 计算总金额 → upsert 联系人
   */
  async create(dto: CreateSalesOrderDto): Promise<SalesOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('订单商品不能为空');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. 生成订单号
      const orderNo = await this.sequenceService.generate('SO');

      // 2. 查询汇率（始终获取 USD→CNY 汇率）
      const currency = dto.currency || 'USD';
      const exchangeRate = await this.rateService.getRate(
        dto.orderDate || new Date().toISOString().slice(0, 10),
        'USD',
      );

      // 3. 计算总金额并校验明细
      let totalAmountUsd = 0;
      let totalAmountCny = 0;
      const items = dto.items.map((item) => {
        const qty = parseFloat(item.quantity);
        const price = parseFloat(item.unitPrice);
        if (qty <= 0) throw new BadRequestException('订单数量必须大于零');
        if (price <= 0) throw new BadRequestException('销售单价必须大于零');
        const amount = qty * price;
        const amounts = computeDualAmounts(amount, currency, exchangeRate);
        totalAmountUsd += parseFloat(amounts.amountUsd);
        totalAmountCny += parseFloat(amounts.amountCny);
        const prices = computeDualUnitPrice(item.unitPrice, currency, exchangeRate);
        return {
          id: snowflake.nextId(),
          productId: item.productId,
          productModelId: item.productModelId || null,
          quantity: item.quantity,
          unitPriceUsd: prices.unitPriceUsd,
          unitPriceCny: prices.unitPriceCny,
          amountUsd: amounts.amountUsd,
          amountCny: amounts.amountCny,
          shippedQuantity: '0',
          returnedQuantity: '0',
        };
      });

      // 4. 检查库存并对每个商品冻结
      // 获取商品名称用于错误提示
      const productIds = [...new Set(items.map((i) => i.productId))];
      const products = await this.productRepo.find({
        where: { id: In(productIds) },
      });
      const productNameMap = new Map(
        products.map((p) => [p.id, p.productName]),
      );

      for (const item of items) {
        const invWhere: any = { productId: item.productId };
        if (item.productModelId) {
          invWhere.productModelId = item.productModelId;
        } else {
          invWhere.productModelId = IsNull();
        }
        const inventory = await manager.findOne(Inventory, {
          where: invWhere,
        });
        const productName = productNameMap.get(item.productId) || item.productId;
        if (!inventory) {
          throw new BadRequestException(`商品 ${productName} 无库存记录`);
        }
        const available = parseFloat(inventory.availableQuantity);
        const needed = parseFloat(item.quantity);
        if (available < needed) {
          throw new BadRequestException(
            `商品 ${productName} 库存不足：需要 ${needed}，可用 ${available}`,
          );
        }
      }

      // 5. 创建主表
      const order = this.orderRepo.create({
        id: snowflake.nextId(),
        orderNo,
        salespersonId: dto.salespersonId,
        customerName: dto.customerName,
        orderDate: new Date(dto.orderDate),
        transportChannelId: dto.transportChannelId,
        tradeType: dto.tradeType,
        currency,
        exchangeRate,
        bloggerCommissionRate: dto.bloggerCommissionRate || '5.0000',
        totalAmountUsd: totalAmountUsd.toFixed(2),
        totalAmountCny: totalAmountCny.toFixed(2),
        receivedAmountUsd: '0',
        receivedAmountCny: '0',
        bloggerCommissionAmountUsd: '0',
        bloggerCommissionAmountCny: '0',
        shipmentStatus: 1,
        paymentStatus: 1,
        status: 1,
        remark: dto.remark || null,
      });
      const savedOrder = await manager.save(order);

      // 6. 创建明细
      const savedItems = items.map((item) =>
        this.itemRepo.create({ ...item, orderId: savedOrder.id }),
      );
      await manager.save(savedItems);

      // 7. 冻结库存（逐个商品，在同一事务中）并记录估算产品成本
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const freezeResult = await this.fifoService.freeze(
          item.productId,
          item.productModelId,
          parseFloat(item.quantity),
          savedOrder.id,
          manager,
        );

        // 从冻结批次计算估算产品成本
        let estCostCny = 0;
        let estCostUsd = 0;
        for (const fi of freezeResult.items) {
          const batch = await manager.findOne(InventoryBatch, {
            where: { id: fi.batchId },
          });
          if (batch) {
            estCostCny += fi.quantity * parseFloat(batch.unitCostCny || '0');
            estCostUsd += fi.quantity * parseFloat(batch.unitCostUsd || '0');
          }
        }

        // 写入订单明细的估算成本字段
        await manager.getRepository(SalesOrderItem).update(
          { id: savedItems[i].id },
          {
            estimatedCostCny: estCostCny.toFixed(2),
            estimatedCostUsd: estCostUsd.toFixed(2),
          },
        );
      }

      // 8. 同步创建成本记录（可选）
      if (dto.costs && dto.costs.length > 0) {
        // 校验成本类型是否重复
        const costTypeIds = dto.costs.map((c) => c.costTypeId);
        const duplicateIds = costTypeIds.filter(
          (id, index) => costTypeIds.indexOf(id) !== index,
        );
        if (duplicateIds.length > 0) {
          const uniqueDuplicates = [...new Set(duplicateIds)];
          const costTypes = await this.costTypeRepo.find({
            where: { id: uniqueDuplicates as any },
          });
          const duplicateNames = costTypes.map((ct) => ct.costName).join('、');
          throw new BadRequestException(
            `成本类型重复：${duplicateNames}，每个订单同一成本类型只能添加一次`,
          );
        }

        const costRepoTx = manager.getRepository(SalesOrderCost);
        for (const costDto of dto.costs) {
          const costCurrency = costDto.currency || 'CNY';
          const costRate = await this.rateService.getRate(
            dto.orderDate || new Date().toISOString().slice(0, 10),
            'USD',
          );
          const costDual = computeDualAmounts(costDto.amount, costCurrency, costRate);

          const cost = costRepoTx.create({
            id: snowflake.nextId(),
            orderId: savedOrder.id,
            costTypeId: costDto.costTypeId,
            amountUsd: costDual.amountUsd,
            amountCny: costDual.amountCny,
            currency: costCurrency,
            exchangeRate: costRate,
            remark: costDto.remark || null,
          });
          await costRepoTx.save(cost);
        }
      }

      // 9. 同步创建收款记录（可选）
      if (dto.payment) {
        // 同币种直接比较
        const totalInCurrency = currency === 'CNY' ? totalAmountCny : totalAmountUsd;
        const paymentAmount = parseFloat(dto.payment.amount);
        if (paymentAmount > totalInCurrency + 0.01) {
          throw new BadRequestException(
            `收款金额（${paymentAmount.toFixed(2)}）不能超过货物总金额（${totalInCurrency.toFixed(2)}）`,
          );
        }
        const paymentRepoTx = manager.getRepository(Payment);
        const paymentCurrency = currency; // 收款币种 = 订单币种
        const paymentRate = await this.rateService.getRate(
          dto.payment.paymentDate,
          'USD',
        );
        const paymentDual = computeDualAmounts(dto.payment.amount, paymentCurrency, paymentRate);

        const paymentNo = await this.sequenceService.generate('SK');
        const payment = paymentRepoTx.create({
          id: snowflake.nextId(),
          paymentNo,
          type: 1,
          orderId: savedOrder.id,
          paymentDate: new Date(dto.payment.paymentDate),
          amountUsd: paymentDual.amountUsd,
          amountCny: paymentDual.amountCny,
          currency: paymentCurrency,
          exchangeRate: paymentRate,
          paymentMethod: dto.payment.paymentMethod || null,
          payer: dto.payment.payer || null,
        });
        await paymentRepoTx.save(payment);

        // 更新订单已收金额 + 重算三维状态（使用付款记录的 USD/CNY 金额）
        await this.updateReceivedAmount(
          savedOrder.id,
          paymentDual.amountUsd,
          paymentDual.amountCny,
          manager,
        );
      }

      // 10. Upsert 常用联系人
      await this.upsertContact(dto.customerName, manager);

      this.logger.log(`订单创建成功: ${orderNo}`);
      return savedOrder;
    });
  }

  /**
   * 修改订单（仅待发货状态可修改）
   * 修改明细需先解冻旧商品→重新冻结新商品
   * 整个操作在事务中完成，保证原子性
   */
  async update(id: string, dto: UpdateSalesOrderDto): Promise<SalesOrder> {
    return this.dataSource.transaction(async (manager) => {
      let order = await manager.findOne(SalesOrder, { where: { id } });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.shipmentStatus !== 1) {
        throw new BadRequestException('仅待发货状态的订单可以修改');
      }

      // 查询汇率（始终获取 USD→CNY 汇率）
      const orderCurrency = dto.currency || order.currency || 'USD';
      const exchangeRate = await this.rateService.getRate(
        dto.orderDate || (order.orderDate instanceof Date
          ? order.orderDate.toISOString().slice(0, 10)
          : order.orderDate),
        'USD',
      );

      // 显式挑选可修改字段，忽略系统管理字段（status/shipmentStatus/paymentStatus/totalAmountUsd 等）
      if (dto.salespersonId !== undefined) order.salespersonId = dto.salespersonId;
      if (dto.customerName !== undefined) order.customerName = dto.customerName;
      if (dto.orderDate !== undefined) order.orderDate = new Date(dto.orderDate);
      if (dto.transportChannelId !== undefined) order.transportChannelId = dto.transportChannelId;
      if (dto.tradeType !== undefined) order.tradeType = dto.tradeType;
      if (dto.bloggerCommissionRate !== undefined) order.bloggerCommissionRate = dto.bloggerCommissionRate;
      // remark: 空字符串 → null（用户主动清空）
      if (dto.remark !== undefined) order.remark = dto.remark === '' ? null : dto.remark;
      // currency + exchangeRate: 后端自动获取汇率，不信任前端传值
      if (dto.currency !== undefined) order.currency = dto.currency;
      order.exchangeRate = exchangeRate;

      // 如果提供了新的明细，整体替换
      let itemsChanged = false;
      if (dto.items && dto.items.length > 0) {
        itemsChanged = true;
        // 获取旧明细用于解冻
        const oldItems = await manager.find(SalesOrderItem, { where: { orderId: id } });

        // 解冻旧商品（在同一事务中）
        for (const oldItem of oldItems) {
          const qty = parseFloat(oldItem.quantity) - parseFloat(oldItem.shippedQuantity || '0');
          if (qty > 0) {
            await this.fifoService.unfreeze(oldItem.productId, oldItem.productModelId, qty, id, manager);
          }
        }

        // 删除旧明细
        await manager.getRepository(SalesOrderItem).delete({ orderId: id });

        // 校验并创建新明细
        let totalAmountUsd = 0;
        let totalAmountCny = 0;
        const newItems = dto.items.map((item) => {
          const qty = parseFloat(item.quantity);
          const price = parseFloat(item.unitPrice);
          if (qty <= 0) throw new BadRequestException('订单数量必须大于零');
          if (price <= 0) throw new BadRequestException('销售单价必须大于零');
          const amount = qty * price;
          const amounts = computeDualAmounts(amount, orderCurrency, exchangeRate);
          totalAmountUsd += parseFloat(amounts.amountUsd);
          totalAmountCny += parseFloat(amounts.amountCny);
          const prices = computeDualUnitPrice(item.unitPrice, orderCurrency, exchangeRate);
          return manager.getRepository(SalesOrderItem).create({
            id: snowflake.nextId(),
            orderId: id,
            productId: item.productId,
            productModelId: item.productModelId || null,
            quantity: item.quantity,
            unitPriceUsd: prices.unitPriceUsd,
            unitPriceCny: prices.unitPriceCny,
            amountUsd: amounts.amountUsd,
            amountCny: amounts.amountCny,
            shippedQuantity: '0',
            returnedQuantity: '0',
          });
        });

        // 检查库存
        const productIds = [...new Set(newItems.map((i) => i.productId))];
        const products = await this.productRepo.find({
          where: { id: In(productIds) },
        });
        const productNameMap = new Map(
          products.map((p) => [p.id, p.productName]),
        );

        for (const item of newItems) {
          const invWhere: any = { productId: item.productId };
          if (item.productModelId) {
            invWhere.productModelId = item.productModelId;
          } else {
            invWhere.productModelId = IsNull();
          }
          const inventory = await manager.findOne(Inventory, {
            where: invWhere,
          });
          const productName = productNameMap.get(item.productId) || item.productId;
          if (!inventory) {
            throw new BadRequestException(`商品 ${productName} 无库存记录`);
          }
          const available = parseFloat(inventory.availableQuantity);
          const needed = parseFloat(item.quantity);
          if (available < needed) {
            throw new BadRequestException(
              `商品 ${productName} 库存不足：需要 ${needed}，可用 ${available}`,
            );
          }
        }

        await manager.save(newItems);

        // 冻结新商品（在同一事务中）并记录估算产品成本
        for (const item of newItems) {
          const freezeResult = await this.fifoService.freeze(
            item.productId,
            item.productModelId,
            parseFloat(item.quantity),
            id,
            manager,
          );

          // 从冻结批次计算估算产品成本
          let estCostCny = 0;
          let estCostUsd = 0;
          for (const fi of freezeResult.items) {
            const batch = await manager.findOne(InventoryBatch, {
              where: { id: fi.batchId },
            });
            if (batch) {
              estCostCny += fi.quantity * parseFloat(batch.unitCostCny || '0');
              estCostUsd += fi.quantity * parseFloat(batch.unitCostUsd || '0');
            }
          }

          // 写入订单明细的估算成本字段
          await manager.getRepository(SalesOrderItem).update(
            { id: item.id },
            {
              estimatedCostCny: estCostCny.toFixed(2),
              estimatedCostUsd: estCostUsd.toFixed(2),
            },
          );
        }

        // 商品总价变更后，校验已收金额不能超出新总价（同币种直接比较）
        const currency = orderCurrency;
        const newTotal = currency === 'CNY'
          ? parseFloat(totalAmountCny.toFixed(2))
          : parseFloat(totalAmountUsd.toFixed(2));
        const received = currency === 'CNY'
          ? parseFloat(order.receivedAmountCny || '0')
          : parseFloat(order.receivedAmountUsd || '0');
        if (received > newTotal + 0.01 && newTotal > 0) {
          throw new BadRequestException(
            `修改后货物总金额为 ${newTotal.toFixed(2)} ${currency}，但已收款 ${received.toFixed(2)} ${currency}，请先退款后再修改订单`,
          );
        }

        order.totalAmountUsd = totalAmountUsd.toFixed(2);
        order.totalAmountCny = totalAmountCny.toFixed(2);
      }

      // 同步成本记录（整体替换）
      if (dto.costs !== undefined) {
        const costRepoTx = manager.getRepository(SalesOrderCost);
        
        // 校验成本类型是否重复
        if (dto.costs.length > 0) {
          const costTypeIds = dto.costs.map((c) => c.costTypeId);
          const duplicateIds = costTypeIds.filter(
            (id, index) => costTypeIds.indexOf(id) !== index,
          );
          if (duplicateIds.length > 0) {
            const uniqueDuplicates = [...new Set(duplicateIds)];
            const costTypes = await this.costTypeRepo.find({
              where: { id: uniqueDuplicates as any },
            });
            const duplicateNames = costTypes.map((ct) => ct.costName).join('、');
            throw new BadRequestException(
              `成本类型重复：${duplicateNames}，每个订单同一成本类型只能添加一次`,
            );
          }
        }
        
        // 删除旧成本
        await costRepoTx.delete({ orderId: id });
        
        // 创建新成本
        const orderDateStr = dto.orderDate || (order.orderDate instanceof Date
          ? order.orderDate.toISOString().slice(0, 10)
          : order.orderDate);
        for (const costDto of dto.costs) {
          const costCurrency = costDto.currency || 'CNY';
          const costRate = await this.rateService.getRate(orderDateStr, 'USD');
          const costDual = computeDualAmounts(costDto.amount, costCurrency, costRate);

          const cost = costRepoTx.create({
            id: snowflake.nextId(),
            orderId: id,
            costTypeId: costDto.costTypeId,
            amountUsd: costDual.amountUsd,
            amountCny: costDual.amountCny,
            currency: costCurrency,
            exchangeRate: costRate,
            remark: costDto.remark || null,
          });
          await costRepoTx.save(cost);
        }
      }

      // 客户名称变更时同步常用联系人
      if (dto.customerName !== undefined) {
        await this.upsertContact(dto.customerName, manager);
      }

      const saved = await manager.save(order);

      // 商品明细变更后，重算收款/发货状态
      if (itemsChanged) {
        await this.recalculateStatus(id, manager);
      }

      return saved;
    });
  }

  /**
   * 查询订单详情（聚合：主表 + 明细 + 成本）
   */
  async findOne(id: string): Promise<SalesOrder & { items: SalesOrderItem[] }> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new BadRequestException('订单不存在');

    const items = await this.itemRepo.find({ where: { orderId: id } });

    // 批量查询型号名称
    const modelIds = items
      .map((i) => i.productModelId)
      .filter((id): id is string => !!id);
    const modelNameMap = new Map<string, string>();
    if (modelIds.length > 0) {
      const models = await this.productModelRepo.find({
        where: { id: In(modelIds) },
      });
      for (const m of models) {
        modelNameMap.set(m.id, m.modelName);
      }
    }

    const itemsWithModel = items.map((item) => ({
      ...item,
      modelName: item.productModelId
        ? modelNameMap.get(item.productModelId)
        : undefined,
    }));

    return { ...order, items: itemsWithModel as any };
  }

  /**
   * 分页查询订单列表
   * 支持三维状态、日期、销售员等多维筛选
   */
  async findAll(query: QuerySalesOrderDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.orderRepo.createQueryBuilder('so');

    if (query.orderNo) {
      qb.andWhere('so.orderNo LIKE :no', { no: `%${query.orderNo}%` });
    }
    if (query.status !== undefined) {
      qb.andWhere('so.status = :status', { status: query.status });
    }
    if (query.shipmentStatus !== undefined) {
      qb.andWhere('so.shipmentStatus = :shipmentStatus', {
        shipmentStatus: query.shipmentStatus,
      });
    }
    if (query.paymentStatus !== undefined) {
      qb.andWhere('so.paymentStatus = :paymentStatus', {
        paymentStatus: query.paymentStatus,
      });
    }
    if (query.salespersonId) {
      qb.andWhere('so.salespersonId = :salespersonId', {
        salespersonId: query.salespersonId,
      });
    }
    if (query.startDate) {
      qb.andWhere('so.orderDate >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('so.orderDate <= :endDate', { endDate: query.endDate });
    }

    qb.orderBy('so.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();

    // 动态计算博主佣金 + 销售利润 + 销售员提成
    if (list.length > 0) {
      const orderIds = list.map((o) => o.id);

      // 批量查询销售员的提成比例
      const defaultRate = this.configService.get<number>('DEFAULT_COMMISSION_RATE', 40);
      const spIds = [...new Set(list.map((o) => o.salespersonId).filter(Boolean))];
      const spCommissionRateMap = new Map<string, number>();
      if (spIds.length > 0) {
        const spRows = await this.dataSource.query(
          `SELECT id, commission_rate AS commissionRate FROM salesperson WHERE id IN (?)`,
          [spIds],
        );
        for (const row of spRows) {
          spCommissionRateMap.set(row.id, parseFloat(row.commissionRate || String(defaultRate)));
        }
      }

      // 批量查询产品成本（来自 shipment_item.total_cost_cny）
      const productCostRows = await this.dataSource.query(
        `SELECT s.order_id AS orderId, COALESCE(SUM(si.total_cost_cny), 0) AS totalCostCny
         FROM shipment_item si
         INNER JOIN shipment s ON s.id = si.shipment_id
         WHERE s.order_id IN (?)
         GROUP BY s.order_id`,
        [orderIds],
      );
      const productCostMap = new Map<string, number>();
      for (const row of productCostRows) {
        productCostMap.set(row.orderId, parseFloat(row.totalCostCny || '0'));
      }

      // 批量查询额外成本（来自 sales_order_cost.amount_cny）
      const extraCostRows = await this.dataSource.query(
        `SELECT order_id AS orderId, COALESCE(SUM(amount_cny), 0) AS totalCny
         FROM sales_order_cost
         WHERE order_id IN (?)
         GROUP BY order_id`,
        [orderIds],
      );
      const extraCostMap = new Map<string, number>();
      for (const row of extraCostRows) {
        extraCostMap.set(row.orderId, parseFloat(row.totalCny || '0'));
      }

      // 批量查询未发货部分的估算产品成本
      // P5: remaining = effectiveQty - GREATEST(inCustomerHands, 0)
      //           = (qty - refundRet) - GREATEST(shipped - returned, 0)
      const unshippedEstRows = await this.dataSource.query(
        `SELECT order_id AS orderId,
                COALESCE(SUM(estimated_cost_cny * GREATEST(
                  quantity - COALESCE(refund_returned_quantity, 0) - GREATEST(COALESCE(shipped_quantity, 0) - COALESCE(returned_quantity, 0), 0)
                , 0) / quantity), 0) AS estCostCny
         FROM sales_order_item
         WHERE order_id IN (?)
           AND quantity > 0
           AND (quantity - COALESCE(refund_returned_quantity, 0) - GREATEST(COALESCE(shipped_quantity, 0) - COALESCE(returned_quantity, 0), 0)) > 0
         GROUP BY order_id`,
        [orderIds],
      );
      const unshippedEstCostMap = new Map<string, number>();
      for (const row of unshippedEstRows) {
        unshippedEstCostMap.set(row.orderId, parseFloat(row.estCostCny || '0'));
      }

      for (const order of list) {
        // 博主佣金：根据订单金额 × 佣金比例计算（展示全额收款时的预期利润）
        const rate = parseFloat(order.bloggerCommissionRate || '0');
        const totalCny = parseFloat(order.totalAmountCny || '0');
        const bloggerCommissionCny = totalCny * rate / 100;
        const exchangeRate = parseFloat(order.exchangeRate || String(this.rateService.getDefaultRate()));
        const bloggerCommissionUsd = exchangeRate > 0 ? bloggerCommissionCny / exchangeRate : 0;
        (order as any).bloggerCommissionAmountCny = bloggerCommissionCny.toFixed(2);
        (order as any).bloggerCommissionAmountUsd = bloggerCommissionUsd.toFixed(2);

        // 销售利润 = 订单金额 - 博主佣金 - 已退款 - 直接退款 - 产品成本(已发货实际+未发货估算) - 额外成本
        const productCostCny = (productCostMap.get(order.id) || 0) + (unshippedEstCostMap.get(order.id) || 0);
        const extraCostCny = extraCostMap.get(order.id) || 0;
        const refundedAmountCny = parseFloat(order.refundedAmountCny || '0');
        const standaloneRefundedAmountCny = parseFloat(order.standaloneRefundedAmountCny || '0');
        const salesProfitCny = totalCny - bloggerCommissionCny - refundedAmountCny - standaloneRefundedAmountCny - productCostCny - extraCostCny;
        const salesProfitUsd = exchangeRate > 0 ? salesProfitCny / exchangeRate : 0;
        (order as any).salesProfitCny = salesProfitCny.toFixed(2);
        (order as any).salesProfitUsd = salesProfitUsd.toFixed(2);

        // 销售员提成 = 销售利润 × 提成比例
        const spCommissionRate = spCommissionRateMap.get(order.salespersonId) || 0;
        const commissionAmountCny = salesProfitCny * spCommissionRate / 100;
        const commissionAmountUsd = exchangeRate > 0 ? commissionAmountCny / exchangeRate : 0;
        (order as any).commissionAmountUsd = commissionAmountUsd.toFixed(2);
        (order as any).commissionAmountCny = commissionAmountCny.toFixed(2);
      }
    }

    return { list, total, page, pageSize };
  }

  /**
   * 取消订单（含库存解冻）
   * - 待发货：释放全部冻结库存 → 取消订单
   * - 已发货：拒绝取消，引导退货
   * - 已收款/部分收款：提示需先退款
   * 整个操作在事务中完成，保证原子性
   */
  async cancel(id: string): Promise<{
    order: SalesOrder;
    unfrozenItems: Array<{ productId: string; quantity: number }>;
    needsRefund: boolean;
    refundableAmount: string;
    refundableAmountCny: string;
  }> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      // L1: 在事务内加悲观锁后重验状态，消除 TOCTOU 窗口
      const order = await manager
        .createQueryBuilder(SalesOrder, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :id', { id })
        .getOne();
      if (!order) throw new BadRequestException('订单不存在');
      if (order.status === 2)
        throw new BadRequestException('订单已完成，无法取消');
      if (order.status === 3)
        throw new BadRequestException('订单已取消，请勿重复操作');
      if (order.shipmentStatus === 2 || order.shipmentStatus === 3) {
        throw new BadRequestException('订单已发货，无法取消，请走退货流程');
      }
      if (parseFloat(order.receivedAmountUsd || '0') > 0 || parseFloat(order.receivedAmountCny || '0') > 0) {
        throw new BadRequestException('订单已有收款，请先完成退款后再取消');
      }

      const items = await manager
        .getRepository(SalesOrderItem)
        .find({ where: { orderId: id } });

      // 计算需要解冻的数量：订单数量 - 已发货数量
      const unfrozenItems: Array<{ productId: string; quantity: number }> = [];
      for (const item of items) {
        const orderQty = parseFloat(item.quantity);
        const shippedQty = parseFloat(item.shippedQuantity);
        const toUnfreeze = orderQty - shippedQty;

        if (toUnfreeze > 0) {
          await this.fifoService.unfreeze(
            item.productId,
            item.productModelId,
            toUnfreeze,
            id,
            manager,
          );
          unfrozenItems.push({ productId: item.productId, quantity: toUnfreeze });
        }
      }

      // 标记订单为已取消
      order.status = 3;
      order.remark = `${order.remark || ''}`;
      await manager.save(order);

      // 判断是否需要退款
      const receivedUsd = parseFloat(order.receivedAmountUsd || '0');
      const receivedCny = parseFloat(order.receivedAmountCny || '0');
      const needsRefund = receivedUsd > 0 || receivedCny > 0;

      this.logger.log(
        `订单取消成功: ${order.orderNo}, 解冻 ${unfrozenItems.length} 项, 需退款: ${needsRefund}`,
      );

      return {
        order,
        unfrozenItems,
        needsRefund,
        refundableAmount: order.receivedAmountUsd,
        refundableAmountCny: order.receivedAmountCny,
      };
    });
  }

  /**
   * 重新计算订单三维状态
   * 发货/收款/退货后由系统自动调用
   * - shipment_status: 1=待发货 2=部分发货 3=全部发货
   * - payment_status: 1=未收款 2=部分收款 3=已收款
   * - status: shipment_status=3 且 payment_status=3 → 2=已完成
   *
   * 注意：已取消订单(status=3)不可变更；已完成订单(status=2)允许重算
   * （退货换货会导致 shipmentStatus 下降，订单重新打开为进行中）
   */
  async recalculateStatus(orderId: string, externalManager?: EntityManager): Promise<void> {
    const orderRepo = externalManager ? externalManager.getRepository(SalesOrder) : this.orderRepo;
    const itemRepo = externalManager ? externalManager.getRepository(SalesOrderItem) : this.itemRepo;

    const order = await orderRepo.findOne({ where: { id: orderId } });
    if (!order || order.status === 3) return;

    const items = await itemRepo.find({ where: { orderId } });
    if (items.length === 0) return;

    // 计算发货状态
    // 有效需求量 = 订购量 - 退款退货量（客户不再需要的部分）
    // 客户持有量 = 已发 - 全部退货（无论退款/换货，货已不在客户手中）
    // 全部发货 = 每个明细的客户持有量 ≥ 有效需求量
    let allShipped = true;
    let anyShipped = false;
    for (const item of items) {
      const qty = parseFloat(item.quantity);
      const shipped = parseFloat(item.shippedQuantity);
      const returned = parseFloat(item.returnedQuantity || '0');
      const refundReturned = parseFloat(item.refundReturnedQuantity || '0');
      const effectiveQty = qty - refundReturned;          // 有效需求量（扣除退款退货）
      const inCustomerHands = Math.max(0, shipped - returned); // L1: 防御性下界
      if (inCustomerHands > 0) anyShipped = true;
      if (effectiveQty > 0 && inCustomerHands < effectiveQty) allShipped = false;
    }

    if (allShipped) {
      order.shipmentStatus = 3;
    } else if (anyShipped) {
      order.shipmentStatus = 2;
    } else {
      order.shipmentStatus = 1;
    }

    // 计算收款状态（使用订单原币种比较，避免汇率精度漂移）
    const currency = order.currency || 'USD';
    const totalAmt = parseFloat(
      currency === 'CNY' ? order.totalAmountCny : order.totalAmountUsd,
    );
    const receivedAmt = parseFloat(
      currency === 'CNY' ? order.receivedAmountCny : (order.receivedAmountUsd || '0'),
    );

    if (receivedAmt >= totalAmt && totalAmt > 0) {
      order.paymentStatus = 3;
    } else if (receivedAmt > 0) {
      order.paymentStatus = 2;
    } else {
      order.paymentStatus = 1;
    }

    // 主状态：全部发货 + 已收款 → 已完成；否则回退为进行中
    if (order.shipmentStatus === 3 && order.paymentStatus === 3) {
      order.status = 2;
    } else if (order.status === 2) {
      // 已完成订单因退货换货导致发货状态下降 → 重新打开
      order.status = 1;
    }

    await orderRepo.save(order);
  }

  /**
   * 更新已收金额（收款模块调用）
   * 使用付款记录已计算好的 USD/CNY 金额，避免汇率二次换算不一致
   * @param amountUsd 本次收款对应的 USD 金额
   * @param amountCny 本次付款对应的 CNY 金额
   */
  async updateReceivedAmount(
    orderId: string,
    amountUsd: string,
    amountCny: string,
    externalManager?: EntityManager,
  ): Promise<void> {
    const orderRepo = externalManager ? externalManager.getRepository(SalesOrder) : this.orderRepo;

    // M1: 事务内加行锁，防止并发收款导致 lost-update
    const order = externalManager
      ? await orderRepo
          .createQueryBuilder('o')
          .setLock('pessimistic_write')
          .where('o.id = :id', { id: orderId })
          .getOne()
      : await orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    order.receivedAmountUsd = (
      parseFloat(order.receivedAmountUsd || '0') + parseFloat(amountUsd)
    ).toFixed(2);
    order.receivedAmountCny = (
      parseFloat(order.receivedAmountCny || '0') + parseFloat(amountCny)
    ).toFixed(2);

    await orderRepo.save(order);
    await this.recalculateStatus(orderId, externalManager);
  }

  /**
   * 累加已退款金额（退货退款模块调用）
   * 退款不扣减已收金额，而是记录到独立的 refundedAmount 字段
   * 这样 receivedAmount 始终反映实际收款历史，paymentStatus 不受退款影响
   * @param amountUsd 本次退款对应的 USD 金额
   * @param amountCny 本次退款对应的 CNY 金额
   */
  async increaseRefundedAmount(
    orderId: string,
    amountUsd: string,
    amountCny: string,
    externalManager?: EntityManager,
  ): Promise<void> {
    const orderRepo = externalManager ? externalManager.getRepository(SalesOrder) : this.orderRepo;

    // M1: 事务内加行锁，防止并发退款导致 lost-update
    const order = externalManager
      ? await orderRepo
          .createQueryBuilder('o')
          .setLock('pessimistic_write')
          .where('o.id = :id', { id: orderId })
          .getOne()
      : await orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    const newRefundedUsd = parseFloat(order.refundedAmountUsd || '0') + parseFloat(amountUsd);
    const newRefundedCny = parseFloat(order.refundedAmountCny || '0') + parseFloat(amountCny);

    // M2: 仅校验订单币种方向的退款上限（另一币种由汇率换算得出，不做独立校验，避免舍入偏差误拒）
    const receivedUsd = parseFloat(order.receivedAmountUsd || '0');
    const receivedCny = parseFloat(order.receivedAmountCny || '0');
    if (order.currency === 'USD') {
      if (newRefundedUsd > receivedUsd + 0.01) {
        throw new BadRequestException('累计退款金额超出已收金额');
      }
    } else {
      if (newRefundedCny > receivedCny + 0.01) {
        throw new BadRequestException('累计退款金额超出已收金额');
      }
    }

    order.refundedAmountUsd = newRefundedUsd.toFixed(2);
    order.refundedAmountCny = newRefundedCny.toFixed(2);

    await orderRepo.save(order);
  }

  /**
   * 扣减已收金额（直接退款模块调用）
   * 直接退款会减少 receivedAmount，触发 paymentStatus 和 status 重算
   * @param amountUsd 本次退款对应的 USD 金额
   * @param amountCny 本次退款对应的 CNY 金额
   */
  async decreaseReceivedAmount(
    orderId: string,
    amountUsd: string,
    amountCny: string,
    externalManager?: EntityManager,
  ): Promise<void> {
    const orderRepo = externalManager ? externalManager.getRepository(SalesOrder) : this.orderRepo;

    // M1: 事务内加行锁，防止并发退款导致 lost-update
    const order = externalManager
      ? await orderRepo
          .createQueryBuilder('o')
          .setLock('pessimistic_write')
          .where('o.id = :id', { id: orderId })
          .getOne()
      : await orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    const newReceivedUsd = parseFloat(order.receivedAmountUsd || '0') - parseFloat(amountUsd);
    const newReceivedCny = parseFloat(order.receivedAmountCny || '0') - parseFloat(amountCny);

    if (newReceivedUsd < -0.01 || newReceivedCny < -0.01) {
      throw new BadRequestException('退款金额超出已收金额');
    }

    order.receivedAmountUsd = Math.max(0, newReceivedUsd).toFixed(2);
    order.receivedAmountCny = Math.max(0, newReceivedCny).toFixed(2);

    await orderRepo.save(order);
    await this.recalculateStatus(orderId, externalManager);
  }

  /**
   * 累加直接退款金额（直接退款模块调用）
   * 记录不经过退货流程的直接退款累计金额，用于利润计算
   * @param amountUsd 本次退款对应的 USD 金额
   * @param amountCny 本次退款对应的 CNY 金额
   */
  async increaseStandaloneRefundedAmount(
    orderId: string,
    amountUsd: string,
    amountCny: string,
    externalManager?: EntityManager,
  ): Promise<void> {
    const orderRepo = externalManager ? externalManager.getRepository(SalesOrder) : this.orderRepo;

    // M1: 事务内加行锁，防止并发退款导致 lost-update
    const order = externalManager
      ? await orderRepo
          .createQueryBuilder('o')
          .setLock('pessimistic_write')
          .where('o.id = :id', { id: orderId })
          .getOne()
      : await orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    order.standaloneRefundedAmountUsd = (
      parseFloat(order.standaloneRefundedAmountUsd || '0') + parseFloat(amountUsd)
    ).toFixed(2);
    order.standaloneRefundedAmountCny = (
      parseFloat(order.standaloneRefundedAmountCny || '0') + parseFloat(amountCny)
    ).toFixed(2);

    await orderRepo.save(order);
  }

  /**
   * 扣减直接退款金额（收款冲抵时调用）
   * 后续收款优先冲抵此前的直接退款：把已退款"还"回来后，standaloneRefundedAmount 相应减少，
   * 利润随之恢复。仅调整 standalone 字段，不影响 receivedAmount 与三维状态。
   * @param amountUsd 冲抵的 USD 金额
   * @param amountCny 冲抵的 CNY 金额
   */
  async decreaseStandaloneRefundedAmount(
    orderId: string,
    amountUsd: string,
    amountCny: string,
    externalManager?: EntityManager,
  ): Promise<void> {
    const orderRepo = externalManager ? externalManager.getRepository(SalesOrder) : this.orderRepo;

    // M1: 事务内加行锁，防止并发冲抵导致 lost-update
    const order = externalManager
      ? await orderRepo
          .createQueryBuilder('o')
          .setLock('pessimistic_write')
          .where('o.id = :id', { id: orderId })
          .getOne()
      : await orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    const newUsd = parseFloat(order.standaloneRefundedAmountUsd || '0') - parseFloat(amountUsd);
    const newCny = parseFloat(order.standaloneRefundedAmountCny || '0') - parseFloat(amountCny);

    order.standaloneRefundedAmountUsd = Math.max(0, newUsd).toFixed(2);
    order.standaloneRefundedAmountCny = Math.max(0, newCny).toFixed(2);

    await orderRepo.save(order);
  }

  /**
   * 更新已发数量（发货模块调用）
   */
  async updateShippedQuantity(
    orderId: string,
    itemId: string,
    shippedQty: number,
    externalManager?: EntityManager,
  ): Promise<void> {
    const itemRepo = externalManager ? externalManager.getRepository(SalesOrderItem) : this.itemRepo;

    const item = await itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new BadRequestException('订单明细不存在');

    item.shippedQuantity = (
      parseFloat(item.shippedQuantity) + shippedQty
    ).toFixed(4);
    await itemRepo.save(item);

    await this.recalculateStatus(orderId, externalManager);
  }

  /**
   * 利润摘要
   * 产品成本 = SUM(shipment_item.totalCost) — CNY（FIFO 写入时已转 CNY）
   * 额外成本 = SUM(cost.amount_cny) — 预存 CNY
   * 博主佣金 = totalAmountCny × 佣金比例 / 100（CNY）
   * 净额 = totalAmountCny - 博主佣金 - 已退款 - 直接退款（CNY）
   * 销售利润 = 订单金额CNY - 博主佣金 - 已退款 - 直接退款 - 产品成本CNY - 额外成本CNY
   * 利润率 = 销售利润 / 订单金额CNY × 100%
   *
   * USD 列由 CNY ÷ exchangeRate 反算（exchangeRate = USD→CNY）
   */
  async getProfitSummary(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    const exchangeRate = parseFloat(order.exchangeRate || this.rateService.getDefaultRate());

    // ── 产品成本（CNY）= 已发货实际成本 + 未发货估算成本 ──
    // 已发货实际成本来自 FIFO（shipment_item.total_cost_cny）
    const costResult = await this.shipmentItemRepo
      .createQueryBuilder('si')
      .innerJoin('shipment', 's', 's.id = si.shipment_id')
      .select('COALESCE(SUM(si.total_cost_cny), 0)', 'totalCost')
      .where('s.order_id = :orderId', { orderId })
      .getRawOne();
    const shippedActualCostCny = parseFloat(costResult?.totalCost || '0');

    // 未发货部分使用冻结时的估算成本（区分退货退款和退货换货）
    // remaining = effectiveQty - inCustomerHands = (qty - refundReturned) - (shipped - returned)
    const orderItems = await this.itemRepo.find({ where: { orderId } });
    let unshippedEstCostCny = 0;
    for (const item of orderItems) {
      const qty = parseFloat(item.quantity);
      const shippedQty = parseFloat(item.shippedQuantity || '0');
      const returned = parseFloat(item.returnedQuantity || '0');
      const refundReturned = parseFloat(item.refundReturnedQuantity || '0');
      const effectiveQty = qty - refundReturned;
      const inCustomerHands = Math.max(0, shippedQty - returned); // P5: 防御性下界
      const remaining = Math.max(0, effectiveQty - inCustomerHands);
      const estCost = parseFloat(item.estimatedCostCny || '0');
      if (qty > 0 && remaining > 0 && estCost > 0) {
        unshippedEstCostCny += estCost * (remaining / qty);
      }
    }

    const productCostCny = shippedActualCostCny + unshippedEstCostCny;
    const productCostUsd = exchangeRate > 0 ? productCostCny / exchangeRate : 0;

    // ── 额外成本（预存 amount_cny，直接 SUM）──
    const extraCostResult = await this.costRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount_cny), 0)', 'totalCny')
      .where('c.order_id = :orderId', { orderId })
      .getRawOne();
    const extraCostCny = parseFloat(extraCostResult?.totalCny || '0');
    const extraCostUsd = exchangeRate > 0 ? extraCostCny / exchangeRate : 0;

    // ── 博主佣金 & 已退款 & 直接退款 & 净额 ──
    const totalAmountCny = parseFloat(order.totalAmountCny || '0');
    const commissionRate = parseFloat(order.bloggerCommissionRate || '0');
    const bloggerCommissionCny = totalAmountCny * commissionRate / 100;
    const bloggerCommissionUsd = exchangeRate > 0 ? bloggerCommissionCny / exchangeRate : 0;

    // 已退款金额（退货退款/仅退款产生的退款）
    const refundedAmountCny = parseFloat(order.refundedAmountCny || '0');
    const refundedAmountUsd = exchangeRate > 0 ? refundedAmountCny / exchangeRate : 0;

    // 直接退款金额（不经过退货流程的直接退款）
    const standaloneRefundedAmountCny = parseFloat(order.standaloneRefundedAmountCny || '0');
    const standaloneRefundedAmountUsd = exchangeRate > 0 ? standaloneRefundedAmountCny / exchangeRate : 0;

    // 净额 = 订单金额 - 博主佣金 - 已退款 - 直接退款
    const netAmountCny = totalAmountCny - bloggerCommissionCny - refundedAmountCny - standaloneRefundedAmountCny;
    const netAmountUsd = exchangeRate > 0 ? netAmountCny / exchangeRate : 0;

    // ── 销售利润 & 利润率 ──
    const salesProfitCny = totalAmountCny - bloggerCommissionCny - refundedAmountCny - standaloneRefundedAmountCny - productCostCny - extraCostCny;
    const salesProfitUsd = exchangeRate > 0 ? salesProfitCny / exchangeRate : 0;
    const profitRate = totalAmountCny > 0 ? (salesProfitCny / totalAmountCny) * 100 : 0;

    const f = (n: number) => n.toFixed(2);

    // ── 销售员提成 = 销售利润 × 提成比例 ──
    const defaultRate = this.configService.get<number>('DEFAULT_COMMISSION_RATE', 40);
    let spCommissionRate = 0;
    if (order.salespersonId) {
      const spRow = await this.dataSource.query(
        `SELECT commission_rate AS commissionRate FROM salesperson WHERE id = ?`,
        [order.salespersonId],
      );
      if (spRow.length > 0) {
        spCommissionRate = parseFloat(spRow[0].commissionRate || String(defaultRate));
      }
    }
    const salespersonCommissionCny = salesProfitCny * spCommissionRate / 100;
    const salespersonCommissionUsd = exchangeRate > 0 ? salespersonCommissionCny / exchangeRate : 0;

    return {
      productCostUsd: f(productCostUsd),
      productCostCny: f(productCostCny),
      extraCostUsd: f(extraCostUsd),
      extraCostCny: f(extraCostCny),
      bloggerCommissionUsd: f(bloggerCommissionUsd),
      bloggerCommissionCny: f(bloggerCommissionCny),
      salespersonCommissionUsd: f(salespersonCommissionUsd),
      salespersonCommissionCny: f(salespersonCommissionCny),
      netAmountUsd: f(netAmountUsd),
      netAmountCny: f(netAmountCny),
      refundedAmountUsd: f(refundedAmountUsd),
      refundedAmountCny: f(refundedAmountCny),
      standaloneRefundedAmountUsd: f(standaloneRefundedAmountUsd),
      standaloneRefundedAmountCny: f(standaloneRefundedAmountCny),
      exchangeRate: order.exchangeRate,
      salesProfitUsd: f(salesProfitUsd),
      salesProfitCny: f(salesProfitCny),
      profitRate: f(profitRate),
    };
  }

  /** 获取订单 Repository */
  getOrderRepo(): Repository<SalesOrder> {
    return this.orderRepo;
  }

  /** 获取明细 Repository */
  getItemRepo(): Repository<SalesOrderItem> {
    return this.itemRepo;
  }

  /**
   * Upsert 常用联系人
   */
  private async upsertContact(
    customerName: string,
    manager: EntityManager,
  ): Promise<void> {
    if (!customerName) return;

    const existing = await manager.findOne(CommonContact, {
      where: { contactName: customerName },
    });

    if (existing) {
      existing.usageCount += 1;
      existing.lastUsedTime = new Date();
      await manager.save(existing);
    } else {
      const contact = manager.create(CommonContact, {
        id: snowflake.nextId(),
        contactName: customerName,
        usageCount: 1,
        lastUsedTime: new Date(),
      });
      await manager.save(contact);
    }
  }
}
