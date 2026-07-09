import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { SalesOrder } from './entities/sales-order.entity';
import { SalesOrderItem } from './entities/sales-order-item.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { FifoService } from '@/modules/inventory/services/fifo.service';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { CommonContact } from '@/modules/common-contact/entities/common-contact.entity';
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity';
import { SalesOrderCost } from './entities/sales-order-cost.entity';
import { CostType } from '@/modules/cost-type/entities/cost-type.entity';
import { snowflake } from '@/common/utils/snowflake';
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
    private readonly sequenceService: SequenceService,
    private readonly fifoService: FifoService,
    private readonly dataSource: DataSource,
    private readonly rateService: RateService,
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

      // 2. 计算总金额并校验明细
      let totalAmount = 0;
      const items = dto.items.map((item) => {
        const qty = parseFloat(item.quantity);
        const price = parseFloat(item.unitPrice);
        if (qty <= 0) throw new BadRequestException('订单数量必须大于零');
        if (price <= 0) throw new BadRequestException('销售单价必须大于零');
        const amount = qty * price;
        totalAmount += amount;
        return {
          id: snowflake.nextId(),
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: amount.toFixed(2),
          shippedQuantity: '0',
          returnedQuantity: '0',
        };
      });

      // 3. 检查库存并对每个商品冻结
      for (const item of items) {
        const inventory = await manager.findOne(Inventory, {
          where: { productId: item.productId },
        });
        if (!inventory) {
          throw new BadRequestException(`商品 ${item.productId} 无库存记录`);
        }
        const available = parseFloat(inventory.availableQuantity);
        const needed = parseFloat(item.quantity);
        if (available < needed) {
          throw new BadRequestException(
            `商品 ${item.productId} 库存不足：需要 ${needed}，可用 ${available}`,
          );
        }
      }

      let rate;
      try {
        const res = await this.rateService.getRate({
          date: dto.orderDate || '',
          base: dto.currency || 'USD',
        });

        if (!res?.isDefault && res?.rate) {
          rate = res?.rate;
        }
      } catch (error) {
        // ignore
      }

      // 4. 创建主表
      const order = this.orderRepo.create({
        id: snowflake.nextId(),
        orderNo,
        salespersonId: dto.salespersonId,
        customerName: dto.customerName,
        orderDate: new Date(dto.orderDate),
        transportChannelId: dto.transportChannelId,
        tradeType: dto.tradeType,
        currency: dto.currency || 'USD',
        exchangeRate: rate || dto.exchangeRate || dto.exchangeRate || '6.8',
        bloggerCommissionRate: dto.bloggerCommissionRate || '5.0000',
        totalAmount: totalAmount.toFixed(2),
        receivedAmount: '0',
        receivedAmountCny: '0',
        shipmentStatus: 1,
        paymentStatus: 1,
        status: 1,
        remark: dto.remark || null,
      });
      const savedOrder = await manager.save(order);

      // 5. 创建明细
      const savedItems = items.map((item) =>
        this.itemRepo.create({ ...item, orderId: savedOrder.id }),
      );
      await manager.save(savedItems);

      // 6. 冻结库存（逐个商品，在同一事务中）
      for (const item of items) {
        await this.fifoService.freeze(
          item.productId,
          parseFloat(item.quantity),
          savedOrder.id,
          manager,
        );
      }

      // 7. Upsert 常用联系人
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
      const order = await manager.findOne(SalesOrder, { where: { id } });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.shipmentStatus !== 1) {
        throw new BadRequestException('仅待发货状态的订单可以修改');
      }

      if (dto.customerName !== undefined) {
        order.customerName = dto.customerName;
      }
      if (dto.remark !== undefined) {
        order.remark = dto.remark;
      }

      // 如果提供了新的明细，整体替换
      if (dto.items && dto.items.length > 0) {
        // 获取旧明细用于解冻
        const oldItems = await manager.find(SalesOrderItem, { where: { orderId: id } });

        // 解冻旧商品（在同一事务中）
        for (const oldItem of oldItems) {
          const qty = parseFloat(oldItem.quantity);
          if (qty > 0) {
            await this.fifoService.unfreeze(oldItem.productId, qty, id, manager);
          }
        }

        // 删除旧明细
        await manager.getRepository(SalesOrderItem).delete({ orderId: id });

        // 校验并创建新明细
        let totalAmount = 0;
        const newItems = dto.items.map((item) => {
          const qty = parseFloat(item.quantity);
          const price = parseFloat(item.unitPrice);
          if (qty <= 0) throw new BadRequestException('订单数量必须大于零');
          if (price <= 0) throw new BadRequestException('销售单价必须大于零');
          const amount = qty * price;
          totalAmount += amount;
          return manager.getRepository(SalesOrderItem).create({
            id: snowflake.nextId(),
            orderId: id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: amount.toFixed(2),
            shippedQuantity: '0',
            returnedQuantity: '0',
          });
        });

        // 检查库存
        for (const item of newItems) {
          const inventory = await manager.findOne(Inventory, {
            where: { productId: item.productId },
          });
          if (!inventory) {
            throw new BadRequestException(`商品 ${item.productId} 无库存记录`);
          }
          const available = parseFloat(inventory.availableQuantity);
          const needed = parseFloat(item.quantity);
          if (available < needed) {
            throw new BadRequestException(
              `商品 ${item.productId} 库存不足：需要 ${needed}，可用 ${available}`,
            );
          }
        }

        await manager.save(newItems);

        // 冻结新商品（在同一事务中）
        for (const item of newItems) {
          await this.fifoService.freeze(
            item.productId,
            parseFloat(item.quantity),
            id,
            manager,
          );
        }

        order.totalAmount = totalAmount.toFixed(2);
      }

      return manager.save(order);
    });
  }

  /**
   * 查询订单详情（聚合：主表 + 明细 + 成本）
   */
  async findOne(id: string): Promise<SalesOrder & { items: SalesOrderItem[] }> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new BadRequestException('订单不存在');

    const items = await this.itemRepo.find({ where: { orderId: id } });
    return { ...order, items };
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
    return { list, total, page, pageSize };
  }

  /**
   * 取消订单（含库存解冻）
   * - 待发货：释放全部冻结库存 → 取消订单
   * - 部分发货：释放未发货部分 → 取消
   * - 全部发货：拒绝取消，引导退货
   * - 已收款/部分收款：提示需先退款
   * 整个操作在事务中完成，保证原子性
   */
  async cancel(id: string): Promise<{
    order: SalesOrder;
    unfrozenItems: Array<{ productId: string; quantity: number }>;
    needsRefund: boolean;
    refundableAmount: string;
  }> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new BadRequestException('订单不存在');
    if (order.status === 2)
      throw new BadRequestException('订单已完成，无法取消');
    if (order.status === 3)
      throw new BadRequestException('订单已取消，请勿重复操作');
    if (order.shipmentStatus === 3) {
      throw new BadRequestException('订单已全部发货，无法取消，请走退货流程');
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
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
            toUnfreeze,
            id,
            manager,
          );
          unfrozenItems.push({ productId: item.productId, quantity: toUnfreeze });
        }
      }

      // 标记订单为已取消
      order.status = 3;
      order.remark = `[已取消] ${order.remark || ''}`;
      await manager.save(order);

      // 判断是否需要退款
      const received = parseFloat(order.receivedAmount);
      const needsRefund = received > 0;

      this.logger.log(
        `订单取消成功: ${order.orderNo}, 解冻 ${unfrozenItems.length} 项, 需退款: ${needsRefund}`,
      );

      return {
        order,
        unfrozenItems,
        needsRefund,
        refundableAmount: order.receivedAmount,
      };
    });
  }

  /**
   * 重新计算订单三维状态
   * 发货/收款后由系统自动调用
   * - shipment_status: 1=待发货 2=部分发货 3=全部发货
   * - payment_status: 1=未收款 2=部分收款 3=已收款
   * - status: shipment_status=3 且 payment_status=3 → 2=已完成
   */
  async recalculateStatus(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order || order.status === 2 || order.status === 3) return;

    const items = await this.itemRepo.find({ where: { orderId } });
    if (items.length === 0) return;

    // 计算发货状态
    let allShipped = true;
    let anyShipped = false;
    for (const item of items) {
      const qty = parseFloat(item.quantity);
      const shipped = parseFloat(item.shippedQuantity);
      if (shipped > 0) anyShipped = true;
      if (shipped < qty) allShipped = false;
    }

    if (allShipped) {
      order.shipmentStatus = 3;
    } else if (anyShipped) {
      order.shipmentStatus = 2;
    } else {
      order.shipmentStatus = 1;
    }

    // 计算收款状态
    const totalAmt = parseFloat(order.totalAmount);
    const receivedAmt = parseFloat(order.receivedAmount);

    if (receivedAmt >= totalAmt && totalAmt > 0) {
      order.paymentStatus = 3;
    } else if (receivedAmt > 0) {
      order.paymentStatus = 2;
    } else {
      order.paymentStatus = 1;
    }

    // 主状态：全部发货 + 已收款 → 已完成
    if (order.shipmentStatus === 3 && order.paymentStatus === 3) {
      order.status = 2;
    }

    await this.orderRepo.save(order);
  }

  /**
   * 更新已收金额（收款模块调用）
   */
  async updateReceivedAmount(
    orderId: string,
    usdAmount: string,
    cnyAmount: string,
  ): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    order.receivedAmount = (
      parseFloat(order.receivedAmount) + parseFloat(usdAmount)
    ).toFixed(2);
    order.receivedAmountCny = (
      parseFloat(order.receivedAmountCny) + parseFloat(cnyAmount)
    ).toFixed(2);

    await this.orderRepo.save(order);
    await this.recalculateStatus(orderId);
  }

  /**
   * 扣减已收金额（退款模块调用）
   */
  async decreaseReceivedAmount(
    orderId: string,
    usdAmount: string,
    cnyAmount: string,
  ): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    const newUsd = parseFloat(order.receivedAmount) - parseFloat(usdAmount);
    const newCny = parseFloat(order.receivedAmountCny) - parseFloat(cnyAmount);

    if (newUsd < 0 || newCny < 0) {
      throw new BadRequestException('退款金额超出已收金额');
    }

    order.receivedAmount = newUsd.toFixed(2);
    order.receivedAmountCny = newCny.toFixed(2);

    await this.orderRepo.save(order);
    await this.recalculateStatus(orderId);
  }

  /**
   * 更新已发数量（发货模块调用）
   */
  async updateShippedQuantity(
    orderId: string,
    itemId: string,
    shippedQty: number,
  ): Promise<void> {
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    if (!item) throw new BadRequestException('订单明细不存在');

    item.shippedQuantity = (
      parseFloat(item.shippedQuantity) + shippedQty
    ).toFixed(4);
    await this.itemRepo.save(item);

    await this.recalculateStatus(orderId);
  }

  /**
   * 利润摘要
   * 产品成本 = SUM(shipment_item.totalCost)
   * 额外成本 = SUM(sales_order_cost.amount)
   * 博主佣金 = 已收金额 × 佣金比例 / 100
   * 实收金额 = 已收金额 - 博主佣金
   * 实时CNY = 实收金额 × 汇率（CNY订单不转换）
   * 销售利润 = 实时CNY - 产品成本 - 额外成本
   * 利润率 = 销售利润 / 实时CNY × 100%
   */
  async getProfitSummary(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BadRequestException('订单不存在');

    // 产品成本：已发货批次的 FIFO 成本汇总（CNY）
    // shipment_item 没有 orderId，需通过 shipment 关联
    const costResult = await this.shipmentItemRepo
      .createQueryBuilder('si')
      .innerJoin('shipment', 's', 's.id = si.shipment_id')
      .select('COALESCE(SUM(si.total_cost), 0)', 'totalCost')
      .where('s.order_id = :orderId', { orderId })
      .getRawOne();
    const productCostCny = parseFloat(costResult?.totalCost || '0');

    // 额外成本
    const extraCostResult = await this.costRepo
      .createQueryBuilder('c')
      .select('COALESCE(SUM(c.amount), 0)', 'totalAmount')
      .where('c.order_id = :orderId', { orderId })
      .getRawOne();
    const extraCostCny = parseFloat(extraCostResult?.totalAmount || '0');

    // 博主佣金 & 实收
    const receivedAmount = parseFloat(order.receivedAmount);
    const commissionRate = parseFloat(order.bloggerCommissionRate);
    const bloggerCommission = receivedAmount * commissionRate / 100;
    const netReceived = receivedAmount - bloggerCommission;

    // 实时 CNY
    const exchangeRate = parseFloat(order.exchangeRate);
    const realTimeCny = order.currency === 'CNY'
      ? netReceived
      : netReceived * exchangeRate;

    // 销售利润 & 利润率
    const salesProfit = realTimeCny - productCostCny - extraCostCny;
    const profitRate = realTimeCny > 0
      ? (salesProfit / realTimeCny) * 100
      : 0;

    return {
      productCostCny: productCostCny.toFixed(2),
      extraCostCny: extraCostCny.toFixed(2),
      bloggerCommission: bloggerCommission.toFixed(2),
      netReceived: netReceived.toFixed(2),
      exchangeRate: order.exchangeRate,
      realTimeCny: realTimeCny.toFixed(2),
      salesProfit: salesProfit.toFixed(2),
      profitRate: profitRate.toFixed(2),
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
