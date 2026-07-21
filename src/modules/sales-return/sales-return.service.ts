import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { SalesReturn } from './entities/sales-return.entity';
import { SalesReturnItem } from './entities/sales-return-item.entity';
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity';
import { ShipmentItemBatch } from '@/modules/shipment/entities/shipment-item-batch.entity';
import { Shipment } from '@/modules/shipment/entities/shipment.entity';
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity';
import { Payment } from '@/modules/payment/entities/payment.entity';
import { SalesOrderCost } from '@/modules/sales-order/entities/sales-order-cost.entity';
import { CostType } from '@/modules/cost-type/entities/cost-type.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { SalesOrderService } from '@/modules/sales-order/sales-order.service';
import { snowflake } from '@/common/utils/snowflake';
import { computeDualAmounts } from '@/common/utils/dual-currency';
import { RateService } from '@/common/rate/rate.service';
import { CommissionService } from '@/modules/commission/commission.service';
import type {
  CreateSalesReturnDto,
  QuerySalesReturnDto,
} from './dto/sales-return.dto';

/**
 * 客户退货服务 ⭐
 * 7 步事务：创建退货单 → 恢复原批次库存 → 更新订单退货数量 → 重算状态
 */
@Injectable()
export class SalesReturnService {
  private readonly logger = new Logger(SalesReturnService.name);

  constructor(
    @InjectRepository(SalesReturn)
    private readonly returnRepo: Repository<SalesReturn>,
    @InjectRepository(SalesReturnItem)
    private readonly returnItemRepo: Repository<SalesReturnItem>,
    @InjectRepository(ShipmentItem)
    private readonly shipmentItemRepo: Repository<ShipmentItem>,
    @InjectRepository(ShipmentItemBatch)
    private readonly shipmentBatchRepo: Repository<ShipmentItemBatch>,
    @InjectRepository(InventoryBatch)
    private readonly inventoryBatchRepo: Repository<InventoryBatch>,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderItem)
    private readonly orderItemRepo: Repository<SalesOrderItem>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(SalesOrderCost)
    private readonly costRepo: Repository<SalesOrderCost>,
    @InjectRepository(CostType)
    private readonly costTypeRepo: Repository<CostType>,
    private readonly sequenceService: SequenceService,
    private readonly salesOrderService: SalesOrderService,
    private readonly rateService: RateService,
    private readonly commissionService: CommissionService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 创建客户退货单（7 步事务）⭐
   */
  async create(dto: CreateSalesReturnDto): Promise<SalesReturn> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }
    if ((dto.returnType || 1) === 2 && dto.refund) {
      throw new BadRequestException('退货换货不支持退款，请选择退货退款或仅退款类型');
    }
    // E2: 拒绝重复的发货明细项，防止同一 shipmentItemId 出现多次绕过可退数量校验
    const shipItemIdSet = new Set(dto.items.map((i) => i.shipmentItemId));
    if (shipItemIdSet.size !== dto.items.length) {
      throw new BadRequestException('退货明细中存在重复的发货明细项，请合并数量后重试');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. 校验订单已发货
      let order = await manager.findOne(SalesOrder, {
        where: { id: dto.orderId },
      });
      if (!order) throw new BadRequestException('订单不存在');
      if (order.status === 3) {
        throw new BadRequestException('已取消订单无法退货');
      }
      if (order.shipmentStatus < 2) {
        throw new BadRequestException('订单尚未发货，无法退货');
      }

      // 2. 校验每个明细的退货数量
      // 预取所有 ShipmentItem 以获取 orderItemId，按 orderItemId 排序后再加锁，
      // 保证与 shipment 模块一致的锁序（SalesOrderItem 升序），消除 ABBA 死锁
      const shipmentItemIds = dto.items.map((i) => i.shipmentItemId);
      const shipItems = await manager.find(ShipmentItem, {
        where: { id: In(shipmentItemIds) },
      });
      const shipItemMap = new Map(shipItems.map((si) => [si.id, si]));
      const sortedItems = [...dto.items].sort((a, b) => {
        const oidA = shipItemMap.get(a.shipmentItemId)?.orderItemId || '';
        const oidB = shipItemMap.get(b.shipmentItemId)?.orderItemId || '';
        return oidA.localeCompare(oidB);
      });

      const priorReturnedMap = new Map<string, number>(); // C3: 记录每个发货明细的历史退货量
      for (const item of sortedItems) {
        const shipItem = shipItemMap.get(item.shipmentItemId);
        if (!shipItem) {
          throw new BadRequestException(
            `发货明细 ${item.shipmentItemId} 不存在`,
          );
        }

        // C2: 校验发货明细归属——必须属于当前退货订单
        // P3: 加行锁（与 shipment 保持一致锁序：SalesOrderItem 先于 InventoryBatch，消除 ABBA 死锁）
        const ownerItem = await manager
          .createQueryBuilder(SalesOrderItem, 'oi')
          .setLock('pessimistic_write')
          .where('oi.id = :id', { id: shipItem.orderItemId })
          .getOne();
        if (!ownerItem || ownerItem.orderId !== dto.orderId) {
          throw new BadRequestException(
            `发货明细 ${item.shipmentItemId} 不属于订单 ${dto.orderId}`,
          );
        }

        const returnQty = parseFloat(item.quantity);
        if (returnQty <= 0) throw new BadRequestException('退货数量必须大于零');

        // C4: 加锁查询历史退货（InnoDB gap lock 防止并发退货幻影插入）
        const existingReturns = await manager
          .createQueryBuilder(SalesReturnItem, 'ri')
          .setLock('pessimistic_write')
          .where('ri.shipment_item_id = :sid', { sid: item.shipmentItemId })
          .getMany();
        const totalReturned = existingReturns.reduce(
          (sum, r) => sum + parseFloat(r.quantity),
          0,
        );
        priorReturnedMap.set(item.shipmentItemId, totalReturned);

        const returnable = parseFloat(shipItem.quantity) - totalReturned;
        if (returnQty > returnable) {
          throw new BadRequestException(
            `退货数量 ${returnQty} 超过可退数量 ${returnable}`,
          );
        }
      }

      // H1: 提前锁定 SalesOrder，保证全局锁序 SalesOrderItem → SalesOrder → InventoryBatch → Inventory
      // 消除与 shipment 并发时的 ABBA 死锁（shipment 锁序为 SalesOrderItem → SalesOrder → Batch → Inventory）
      const lockedOrder = await manager
        .createQueryBuilder(SalesOrder, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :id', { id: dto.orderId })
        .getOne();
      // E1: 加锁后重验状态，防止 step 1 无锁读取与加锁之间的 TOCTOU 窗口
      if (!lockedOrder || lockedOrder.status === 3) {
        throw new BadRequestException('订单已取消，无法退货');
      }
      // 用当前读结果替代快照值，确保后续 step 6 退款校验和 step 8 状态比较使用最新数据
      order = lockedOrder;

      // 3. 创建退货单 + 明细
      const returnNo = await this.sequenceService.generate('TH');
      const returnCostVal = parseFloat(dto.returnCost || '0');
      const returnCostCurrency = returnCostVal > 0 ? (dto.returnCostCurrency || 'CNY') : null;
      const returnCostDual = returnCostVal > 0
        ? computeDualAmounts(returnCostVal, returnCostCurrency!, order.exchangeRate || this.rateService.getDefaultRate())
        : null;
      const salesReturn = manager.create(SalesReturn, {
        id: snowflake.nextId(),
        returnNo,
        orderId: dto.orderId,
        returnDate: new Date(dto.returnDate),
        restoreInventory: dto.restoreInventory,
        returnType: dto.returnType || 1,
        reason: dto.reason || null,
        remark: dto.remark || null,
        returnCostUsd: returnCostDual ? returnCostDual.amountUsd : null,
        returnCostCny: returnCostDual ? returnCostDual.amountCny : null,
        returnCostCurrency,
        exchangeRate: order.exchangeRate || this.rateService.getDefaultRate(),
      });
      const savedReturn = await manager.save(salesReturn);

      for (const dtoItem of sortedItems) {
        const shipItem = shipItemMap.get(dtoItem.shipmentItemId)!;
        const returnItem = manager.create(SalesReturnItem, {
          id: snowflake.nextId(),
          salesReturnId: savedReturn.id,
          shipmentItemId: dtoItem.shipmentItemId,
          productId: shipItem!.productId,
          productModelId: shipItem!.productModelId || null,
          quantity: dtoItem.quantity,
          restoreInventory: dto.restoreInventory,
        });
        await manager.save(returnItem);

        // 4. 恢复库存到原批次（仅退款不退货，跳过库存恢复）
        if (dto.restoreInventory === 1 && (dto.returnType || 1) !== 3) {
          // 退货换货(type=2)：退回的货注定要补发，恢复到冻结库存（重新占用）
          // 退货退款(type=1)：货回通用库存，恢复到可用库存
          const isExchange = (dto.returnType || 1) === 2;
          const shipBatches = await manager.find(ShipmentItemBatch, {
            where: { shipmentItemId: dtoItem.shipmentItemId },
            order: { id: 'ASC' },
          });
          const returnQty = parseFloat(dtoItem.quantity);
          let remaining = returnQty;
          let costReduction = 0;
          let costReductionUsd = 0;

          // C3: 跳过历史退货已恢复的批次量（FIFO 顺序一致，避免重复恢复靠前批次）
          let alreadyReturned = priorReturnedMap.get(dtoItem.shipmentItemId) || 0;

          // 按原批次比例恢复
          for (const sb of shipBatches) {
            if (remaining <= 0) break;
            const batchQty = parseFloat(sb.quantity);
            // 先扣除历史退货已占用的该批次额度
            if (alreadyReturned >= batchQty) {
              alreadyReturned -= batchQty;
              continue;
            }
            const restorable = batchQty - alreadyReturned;
            alreadyReturned = 0;
            const toRestore = Math.min(restorable, remaining);

            // 按该批次实际成本累加扣减
            costReduction += toRestore * parseFloat(sb.unitCostCny || '0');
            costReductionUsd += toRestore * parseFloat(sb.unitCostUsd || '0');

            // 恢复库存批次（加悲观锁防止并发退货/发货覆盖同一批次）
            const batch = await manager
              .createQueryBuilder(InventoryBatch, 'b')
              .setLock('pessimistic_write')
              .where('b.id = :id', { id: sb.inventoryBatchId })
              .getOne();
            if (batch) {
              const beforeAvailable = parseFloat(batch.availableQuantity);
              const beforeFrozen = parseFloat(batch.frozenQuantity);

              if (isExchange) {
                // M4: 退货换货也恢复到可用库存（补发走正常 freeze→deduct 路径）
                // 若恢复到 frozen，补发无法消费该冻结量（shipment 从 available 冻结），导致库存搁浅
                batch.availableQuantity = (beforeAvailable + toRestore).toFixed(4);
                batch.stockQuantity = (
                  parseFloat(batch.stockQuantity) + toRestore
                ).toFixed(4);
                const newAvailable = beforeAvailable + toRestore;
                if (beforeFrozen > 0 && newAvailable > 0) {
                  batch.freezeStatus = 2; // 部分冻结
                } else if (beforeFrozen <= 0) {
                  batch.freezeStatus = 1; // 无冻结
                }
              } else {
                // 退货退款：恢复到可用库存，并重算冻结状态
                batch.availableQuantity = (beforeAvailable + toRestore).toFixed(
                  4,
                );
                batch.stockQuantity = (
                  parseFloat(batch.stockQuantity) + toRestore
                ).toFixed(4);
                const newAvailable = beforeAvailable + toRestore;
                if (beforeFrozen > 0 && newAvailable > 0) {
                  batch.freezeStatus = 2; // 部分冻结
                } else if (beforeFrozen <= 0) {
                  batch.freezeStatus = 1; // 无冻结
                }
              }

              // 如果批次已耗尽，恢复为有效
              if (batch.status === 2) batch.status = 1;

              await manager.save(batch);

              // 更新库存汇总（加悲观锁防止并发覆盖）
              const invModelWhere = batch.productModelId
                ? 'i.productModelId = :productModelId'
                : 'i.productModelId IS NULL';
              const invModelParams = batch.productModelId
                ? { productModelId: batch.productModelId }
                : {};
              const inventory = await manager
                .createQueryBuilder(Inventory, 'i')
                .setLock('pessimistic_write')
                .where('i.productId = :productId', { productId: shipItem!.productId })
                .andWhere(invModelWhere, invModelParams)
                .getOne();
              // H3: 库存汇总行必须存在，否则批次与汇总静默分歧
              if (!inventory) {
                throw new BadRequestException(
                  `库存汇总记录不存在（商品=${shipItem!.productId}），无法完成退货库存恢复`,
                );
              }
              if (inventory) {
                // M4: 退货换货与退货退款均恢复到可用库存
                inventory.availableQuantity = (
                  parseFloat(inventory.availableQuantity) + toRestore
                ).toFixed(4);
                inventory.stockQuantity = (
                  parseFloat(inventory.stockQuantity) + toRestore
                ).toFixed(4);
                await manager.save(inventory);

                // 写库存流水
                const flow = manager.create(InventoryFlow, {
                  id: snowflake.nextId(),
                  batchId: batch.id,
                  productId: shipItem!.productId,
                  productModelId: batch.productModelId || null,
                  businessType: 3, // 客户退货
                  businessId: savedReturn.id,
                  changeType: 1, // 入库
                  quantity: String(toRestore),
                  unitCostUsd: sb.unitCostUsd,
                  unitCostCny: sb.unitCostCny || null,
                  totalCostUsd: (toRestore * parseFloat(sb.unitCostUsd || '0')).toFixed(2),
                  totalCostCny: (toRestore * parseFloat(sb.unitCostCny || '0')).toFixed(2),
                  flowCurrency: sb.currency || 'CNY',
                  exchangeRate: sb.exchangeRate || this.rateService.getDefaultRate(),
                  beforeAvailable: beforeAvailable.toFixed(4),
                  afterAvailable: (beforeAvailable + toRestore).toFixed(4),
                  beforeFrozen: beforeFrozen.toFixed(4),
                  afterFrozen: beforeFrozen.toFixed(4),
                });
                await manager.save(flow);
              }
            }

            remaining -= toRestore;
          }

          // 扣减该发货明细的产品成本（CNY + USD）
          if ((costReduction > 0 || costReductionUsd > 0) && shipItem) {
            if (costReduction > 0) {
              shipItem.totalCostCny = (
                parseFloat(shipItem.totalCostCny) - costReduction
              ).toFixed(2);
            }
            if (costReductionUsd > 0) {
              shipItem.totalCostUsd = (
                parseFloat(shipItem.totalCostUsd || '0') - costReductionUsd
              ).toFixed(2);
            }
            shipItem.grossProfitCny = (
              parseFloat(shipItem.salesAmountCny) -
              parseFloat(shipItem.totalCostCny)
            ).toFixed(2);
            shipItem.grossProfitUsd = (
              parseFloat(shipItem.salesAmountUsd) -
              parseFloat(shipItem.totalCostUsd || '0')
            ).toFixed(2);
            await manager.save(shipItem);
          }
        }

        // 5. 更新订单明细 returnedQuantity（仅退款不退货，跳过数量更新）
        if ((dto.returnType || 1) !== 3) {
          // C4: 加行锁防止并发退货 lost-update
          const orderItem = await manager
            .createQueryBuilder(SalesOrderItem, 'oi')
            .setLock('pessimistic_write')
            .where('oi.id = :id', { id: shipItem!.orderItemId })
            .getOne();
          if (orderItem) {
            orderItem.returnedQuantity = (
              parseFloat(orderItem.returnedQuantity) +
              parseFloat(dtoItem.quantity)
            ).toFixed(4);
            // 退货退款（不补发）时累加 refundReturnedQuantity
            if ((dto.returnType || 1) === 1) {
              orderItem.refundReturnedQuantity = (
                parseFloat(orderItem.refundReturnedQuantity || '0') +
                parseFloat(dtoItem.quantity)
              ).toFixed(4);
            }
            await manager.save(orderItem);
          }
        }
      }

      // 6. 退款处理 + 退货成本
      let refundAmountUsdStr: string | null = null;
      let refundAmountCnyStr: string | null = null;
      let refundPaymentId: string | null = null;

      if (dto.refund) {
        // 计算退款金额 = SUM(退货数量 × 发货明细销售单价)
        // 根据订单币种选择正确的单价
        let refundTotal = 0;
        for (const dtoItem of dto.items) {
          const shipItem = await manager.findOne(ShipmentItem, {
            where: { id: dtoItem.shipmentItemId },
          });
          if (shipItem) {
            const unitPrice = (order.currency || 'USD') === 'CNY'
              ? parseFloat(shipItem.salesUnitPriceCny)
              : parseFloat(shipItem.salesUnitPriceUsd);
            refundTotal += parseFloat(dtoItem.quantity) * unitPrice;
          }
        }

        // 校验累计退款金额不超过已收金额（同币种直接比较）
        const currency = order.currency || 'USD';
        const receivedInCurrency = currency === 'CNY'
          ? parseFloat(order.receivedAmountCny || '0')
          : parseFloat(order.receivedAmountUsd || '0');
        const alreadyRefunded = currency === 'CNY'
          ? parseFloat(order.refundedAmountCny || '0')
          : parseFloat(order.refundedAmountUsd || '0');
        if (alreadyRefunded + refundTotal > receivedInCurrency + 0.01) {
          throw new BadRequestException(
            `累计退款金额（${(alreadyRefunded + refundTotal).toFixed(2)}）超过已收金额（${receivedInCurrency.toFixed(2)}）`,
          );
        }

        // 创建退款记录
        const paymentNo = await this.sequenceService.generate('TK');
        const refundDual = computeDualAmounts(refundTotal, currency, order.exchangeRate || this.rateService.getDefaultRate());
        const payment = manager.create(Payment, {
          id: snowflake.nextId(),
          paymentNo,
          type: 2, // 退款
          orderId: dto.orderId,
          paymentDate: new Date(dto.returnDate),
          amountUsd: refundDual.amountUsd,
          exchangeRate: order.exchangeRate,
          amountCny: refundDual.amountCny,
          currency: order.currency || 'USD',
          paymentMethod: dto.paymentMethod || null,
          remark: '客户退货',
        });
        const savedPayment = await manager.save(payment);

        // 累加已退款金额（不扣减已收金额，保持收款记录完整）
        await this.salesOrderService.increaseRefundedAmount(
          dto.orderId,
          refundDual.amountUsd,
          refundDual.amountCny,
          manager,
        );

        refundAmountUsdStr = refundDual.amountUsd;
        refundAmountCnyStr = refundDual.amountCny;
        refundPaymentId = savedPayment.id;
      }

      // 7. 退货成本累加到 SalesOrderCost
      if (returnCostVal > 0) {
        const costCurrency = dto.returnCostCurrency || 'CNY';
        // 与退货单存储使用相同汇率（order.exchangeRate），保证一致性
        const usdToCnyRate = order.exchangeRate || this.rateService.getDefaultRate();
        const costDual = computeDualAmounts(returnCostVal, costCurrency, usdToCnyRate);

        // 查找或创建"客户退货成本"成本类型
        let costType = await this.costTypeRepo.findOne({
          where: { costName: '客户退货成本' },
        });
        if (!costType) {
          costType = await manager.save(
            this.costTypeRepo.create({
              id: snowflake.nextId(),
              costName: '客户退货成本',
              sortNo: 999,
              status: 1,
            }),
          );
        }

        const existingCost = await manager.findOne(SalesOrderCost, {
          where: { orderId: dto.orderId, costTypeId: costType.id },
        });

        if (existingCost) {
          const newCny = parseFloat(existingCost.amountCny) + parseFloat(costDual.amountCny);
          const newUsd = parseFloat(existingCost.amountUsd) + parseFloat(costDual.amountUsd);
          existingCost.amountCny = newCny.toFixed(2);
          existingCost.amountUsd = newUsd.toFixed(2);
          existingCost.exchangeRate = usdToCnyRate;
          await manager.save(existingCost);
        } else {
          // 新建成本记录
          const cost = manager.create(SalesOrderCost, {
            id: snowflake.nextId(),
            orderId: dto.orderId,
            costTypeId: costType.id,
            amountUsd: costDual.amountUsd,
            amountCny: costDual.amountCny,
            currency: costCurrency,
            exchangeRate: usdToCnyRate,
          });
          await manager.save(cost);
        }
      }

      // 8. 重算订单三维状态
      // type=1(退货退款)：effectiveQty 下降，可能使进行中订单满足完成条件
      // type=2(退货换货)：inCustomerHands 下降（returned 增加），可能使已完成订单重新打开
      // type=3(仅退款)：不影响数量，状态不变（调用无副作用）
      await this.salesOrderService.recalculateStatus(dto.orderId, manager);

      // 8.1 如果退货使订单从进行中变为已完成，触发提成计提
      // 仅处理状态跃迁（1→2）；已完成订单(原 status=2)由 step 9 冲回处理，保留审计轨迹
      const updatedOrder = await manager.findOne(SalesOrder, { where: { id: dto.orderId } });
      if (updatedOrder && updatedOrder.status === 2 && order.status !== 2 && updatedOrder.salespersonId) {
        await this.commissionService.accrueOrderCommission(dto.orderId, manager);
      }

      // 8.2 M3: 如果退货使已完成订单重新打开（2→1），全额撤销提成
      // 防止换货等场景下订单长期处于进行中而提成未被冲回
      if (updatedOrder && updatedOrder.status === 1 && order.status === 2 && order.salespersonId) {
        await this.commissionService.revokeOrderCommission(dto.orderId, manager);
      }

      // 9. 退货后重算提成差额（必须在退货成本累加之后调用，确保 calcOrderProfit 获取到最新成本）
      // P2: 仅在订单仍为已完成状态时重算；若 step 8.2 已全额撤销（2→1），不再触发差额计算
      if (dto.refund && order.salespersonId && updatedOrder!.status === 2) {
        await this.commissionService.recalculateOrderCommission(
          order.id,
          refundAmountUsdStr!,
          refundAmountCnyStr!,
          refundPaymentId!,
          savedReturn.id,
          manager,
        );
      }

      // 回写退款信息到退货单
      savedReturn.refundAmountUsd = refundAmountUsdStr;
      savedReturn.refundAmountCny = refundAmountCnyStr;
      savedReturn.refundPaymentId = refundPaymentId;
      await manager.save(savedReturn);

      this.logger.log(`客户退货完成: ${returnNo}, 订单: ${order.orderNo}`);
      return savedReturn;
    });
  }

  /**
   * 查询退货详情（含明细）
   */
  async findOne(id: string) {
    const ret = await this.returnRepo.findOne({ where: { id } });
    if (!ret) throw new BadRequestException('退货单不存在');

    const items = await this.returnItemRepo.find({
      where: { salesReturnId: id },
    });

    // 联表查 orderNo + currency
    const order = await this.dataSource
      .createQueryBuilder()
      .select('o.id, o.order_no, o.currency')
      .from(SalesOrder, 'o')
      .where('o.id = :orderId', { orderId: ret.orderId })
      .getRawOne();
    const orderNo = order?.order_no || null;
    const currency = order?.currency || null;

    // 批量查商品名称
    const productIds = items
      .map((i) => i.productId)
      .filter((id): id is string => !!id);
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

    // 批量查型号名称
    const modelIds = items
      .map((i) => i.productModelId)
      .filter((id): id is string => !!id);
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

    // 批量查发货明细（salesUnitPrice + currency + shipmentId）
    const shipItemIds = items
      .map((i) => i.shipmentItemId)
      .filter((id): id is string => !!id);
    const shipItemMap = new Map<string, { salesUnitPriceUsd: string; salesUnitPriceCny: string; currency: string; shipmentId: string }>();
    if (shipItemIds.length > 0) {
      const shipItems = await this.dataSource
        .createQueryBuilder()
        .select('si.id, si.sales_unit_price_usd, si.sales_unit_price_cny, si.currency, si.shipment_id')
        .from(ShipmentItem, 'si')
        .where('si.id IN (:...ids)', { ids: shipItemIds })
        .getRawMany();
      for (const si of shipItems) {
        shipItemMap.set(si.id, {
          salesUnitPriceUsd: si.sales_unit_price_usd,
          salesUnitPriceCny: si.sales_unit_price_cny,
          currency: si.currency,
          shipmentId: si.shipment_id,
        });
      }
    }

    // 批量查发货单号
    const shipmentIds = [...new Set(
      [...shipItemMap.values()].map((v) => v.shipmentId),
    )];
    const shipmentNoMap = new Map<string, string>();
    if (shipmentIds.length > 0) {
      const shipments = await this.dataSource
        .createQueryBuilder()
        .select('s.id, s.shipment_no')
        .from(Shipment, 's')
        .where('s.id IN (:...ids)', { ids: shipmentIds })
        .getRawMany();
      for (const s of shipments) shipmentNoMap.set(s.id, s.shipment_no);
    }

    const enrichedItems = items.map((item) => {
      const si = shipItemMap.get(item.shipmentItemId);
      return {
        ...item,
        productName: productNameMap.get(item.productId) || undefined,
        modelName: item.productModelId
          ? modelNameMap.get(item.productModelId)
          : undefined,
        salesUnitPriceUsd: si?.salesUnitPriceUsd || undefined,
        salesUnitPriceCny: si?.salesUnitPriceCny || undefined,
        currency: si?.currency || undefined,
        shipmentNo: si ? shipmentNoMap.get(si.shipmentId) : undefined,
      };
    });

    return {
      ...ret,
      orderNo,
      currency,
      items: enrichedItems,
    };
  }

  /**
   * 分页查询退货列表
   */
  async findAll(query: QuerySalesReturnDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.returnRepo
      .createQueryBuilder('r')
      .leftJoin(SalesOrder, 'o', 'o.id = r.order_id')
      .addSelect('o.order_no', 'orderNo')
      .addSelect('o.currency', 'currency');

    if (query.returnNo) {
      qb.andWhere('r.returnNo LIKE :no', { no: `%${query.returnNo}%` });
    }
    if (query.orderId) {
      qb.andWhere('r.orderId = :orderId', { orderId: query.orderId });
    }
    if (query.orderNo) {
      qb.andWhere('o.orderNo = :orderNo', { orderNo: query.orderNo });
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
      orderNo: rawResults[index]?.orderNo || null,
      currency: rawResults[index]?.currency || null,
    }));

    return { list, total: await qb.getCount(), page, pageSize };
  }
}
