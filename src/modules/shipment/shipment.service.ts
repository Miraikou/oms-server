import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { Shipment } from './entities/shipment.entity';
import { ShipmentItem } from './entities/shipment-item.entity';
import { ShipmentItemBatch } from './entities/shipment-item-batch.entity';
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { SalesReturnItem } from '@/modules/sales-return/entities/sales-return-item.entity';
import { SalesReturn } from '@/modules/sales-return/entities/sales-return.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { FifoService } from '@/modules/inventory/services/fifo.service';
import { SalesOrderService } from '@/modules/sales-order/sales-order.service';
import { RateService } from '@/common/rate/rate.service';
import { CommissionService } from '@/modules/commission/commission.service';
import { snowflake } from '@/common/utils/snowflake';
import {
	computeDualUnitPrice,
	computeDualAmounts,
} from '@/common/utils/dual-currency';
import type { CreateShipmentDto, QueryShipmentDto } from './dto/shipment.dto';

/**
 * 发货服务 ⭐
 * 核心业务：8 步事务完成发货，含 FIFO 扣减可用库存、成本计算、利润核算
 */
@Injectable()
export class ShipmentService {
	private readonly logger = new Logger(ShipmentService.name);

	constructor(
		@InjectRepository(Shipment)
		private readonly shipmentRepo: Repository<Shipment>,
		@InjectRepository(ShipmentItem)
		private readonly itemRepo: Repository<ShipmentItem>,
		@InjectRepository(ShipmentItemBatch)
		private readonly batchRepo: Repository<ShipmentItemBatch>,
		@InjectRepository(SalesOrder)
		private readonly orderRepo: Repository<SalesOrder>,
		@InjectRepository(SalesOrderItem)
		private readonly orderItemRepo: Repository<SalesOrderItem>,
		@InjectRepository(InventoryBatch)
		private readonly inventoryBatchRepo: Repository<InventoryBatch>,
		@InjectRepository(ProductModel)
		private readonly productModelRepo: Repository<ProductModel>,
		private readonly sequenceService: SequenceService,
		private readonly fifoService: FifoService,
		private readonly salesOrderService: SalesOrderService,
		private readonly dataSource: DataSource,
		private readonly rateService: RateService,
		private readonly commissionService: CommissionService,
	) {}

	/**
	 * 创建发货单（8 步事务）⭐
	 * 1. 校验订单状态
	 * 2. 校验发货数量 ≤ 可发数量
	 * 3. 创建发货单 + 明细
	 * 4. FIFO 扣减可用库存（不足则报错）
	 * 5. 写入发货批次明细
	 * 6. 汇总成本、计算毛利
	 * 7. 更新订单已发数量 + 重算三维状态
	 * 8. 提交
	 */
	async create(dto: CreateShipmentDto): Promise<Shipment> {
		if (!dto.items || dto.items.length === 0) {
			throw new BadRequestException('发货明细不能为空');
		}

		// 1. 校验订单状态
		const order = await this.orderRepo.findOne({
			where: { id: dto.orderId },
		});
		if (!order) throw new BadRequestException('订单不存在');
		if (order.status !== 1)
			throw new BadRequestException('订单已结束，无法发货');
		if (order.shipmentStatus === 3) {
			throw new BadRequestException('订单已全部发货，无法再次发货');
		}

		// 补发发货单（type=2）前提校验：订单必须存在"补发不退货"(returnType=4)退货单，
		// 防止把正常发货误标记为补发（补发明细销售金额按 0 计，误标会导致收入统计缺失）
		const isReshipment = (dto.type || 1) === 2;
		if (isReshipment) {
			const reshipReturnCount = await this.dataSource
				.createQueryBuilder()
				.from(SalesReturn, 'r')
				.where('r.order_id = :orderId', { orderId: dto.orderId })
				.andWhere('r.return_type = 4')
				.getCount();
			if (reshipReturnCount === 0) {
				throw new BadRequestException(
					'该订单没有"补发不退货"记录，无法创建补发发货单，请先在客户退货中创建补发不退货单',
				);
			}
		}

		// 2. 校验每个明细的发货数量
		const orderItems = await this.orderItemRepo.find({
			where: { orderId: dto.orderId },
		});
		const orderItemMap = new Map(orderItems.map((oi) => [oi.id, oi]));

		for (const item of dto.items) {
			const orderItem = orderItemMap.get(item.orderItemId);
			if (!orderItem) {
				throw new BadRequestException(
					`订单明细 ${item.orderItemId} 不存在`,
				);
			}
			const shipQty = parseFloat(item.quantity);
			if (shipQty <= 0)
				throw new BadRequestException('发货数量必须大于零');

			// 可发数量 = 有效需求量 - 客户实际持有量
			// 有效需求量 = 订购量 - 退款退货量（客户不再需要的部分）
			// 客户持有量 = 已发 - 全部退货（无论退款/换货，货已不在客户手中）
			const qty = parseFloat(orderItem.quantity);
			const shipped = parseFloat(orderItem.shippedQuantity);
			const returned = parseFloat(orderItem.returnedQuantity || '0');
			const refundReturned = parseFloat(
				orderItem.refundReturnedQuantity || '0',
			);
			const effectiveQty = qty - refundReturned;
			const inCustomerHands = Math.max(0, shipped - returned); // L1: 防御性下界
			const remaining = effectiveQty - inCustomerHands;
			if (shipQty > remaining) {
				throw new BadRequestException(
					`发货数量 ${shipQty} 超过可发数量 ${remaining}`,
				);
			}
		}

		// 3-7. 所有写操作包裹在事务中
		return this.dataSource.transaction(async (manager: EntityManager) => {
			const shipmentRepo = manager.getRepository(Shipment);
			const itemRepo = manager.getRepository(ShipmentItem);
			const batchRepo = manager.getRepository(ShipmentItemBatch);

			// 3.0 事务内加锁重验可发数量（防止并发发货 TOCTOU 超发）
			// H4: 按 orderItemId 排序后加锁，防止并发请求以不同顺序锁定明细导致 ABBA 死锁
			const sortedItems = [...dto.items].sort((a, b) =>
				a.orderItemId.localeCompare(b.orderItemId),
			);
			for (const item of sortedItems) {
				const lockedItem = await manager
					.createQueryBuilder(SalesOrderItem, 'oi')
					.setLock('pessimistic_write')
					.where('oi.id = :id', { id: item.orderItemId })
					.getOne();
				if (!lockedItem) {
					throw new BadRequestException(
						`订单明细 ${item.orderItemId} 不存在`,
					);
				}
				const qty = parseFloat(lockedItem.quantity);
				const shipped = parseFloat(lockedItem.shippedQuantity);
				const returned = parseFloat(lockedItem.returnedQuantity || '0');
				const refundReturned = parseFloat(
					lockedItem.refundReturnedQuantity || '0',
				);
				const effectiveQty = qty - refundReturned;
				const inCustomerHands = Math.max(0, shipped - returned); // L1: 防御性下界
				const remaining = effectiveQty - inCustomerHands;
				const shipQty = parseFloat(item.quantity);
				if (shipQty > remaining) {
					throw new BadRequestException(
						`发货数量 ${shipQty} 超过可发数量 ${remaining}（并发校验）`,
					);
				}
			}

			// M2: 事务内重验订单状态（防止并发取消后仍生成发货单）
			const lockedOrder = await manager
				.createQueryBuilder(SalesOrder, 'o')
				.setLock('pessimistic_write')
				.where('o.id = :id', { id: dto.orderId })
				.getOne();
			if (!lockedOrder || lockedOrder.status !== 1) {
				throw new BadRequestException('订单状态已变更，无法发货');
			}

			// 3. 生成发货单号并创建
			const shipmentNo = await this.sequenceService.generate('FH');

			const shipment = shipmentRepo.create({
				id: snowflake.nextId(),
				shipmentNo,
				orderId: dto.orderId,
				expressCompanyId: dto.expressCompanyId,
				trackingNo: dto.trackingNo,
				shipmentDate: new Date(dto.shipmentDate),
				status: 1,
				type: isReshipment ? 2 : 1,
				remark: dto.remark || null,
			});
			const savedShipment = await shipmentRepo.save(shipment);

			// 4-6. 遍历每个明细：创建明细 → FIFO 扣减 → 写批次 → 计算成本/利润
			for (const dtoItem of dto.items) {
				const orderItem = orderItemMap.get(dtoItem.orderItemId)!;
				const shipQty = parseFloat(dtoItem.quantity);
				const orderCurrency = order.currency || 'USD';
				const orderRate =
					order.exchangeRate || (await this.rateService.getDefaultRate());

				// 根据订单币种选择正确的原始单价
				const originalUnitPrice =
					orderCurrency === 'USD'
						? orderItem.unitPriceUsd
						: orderItem.unitPriceCny;
				// 补发发货单不产生新收入：销售单价/销售金额按 0 计，毛利 = -成本，
				// 真实反映补发是纯成本单据（避免按原单价显示导致误以为该单仍盈利）
				const unitPrices = isReshipment
					? { unitPriceUsd: '0.00', unitPriceCny: '0.00' }
					: computeDualUnitPrice(
							originalUnitPrice,
							orderCurrency,
							orderRate,
						);
				const salesAmounts = isReshipment
					? { amountUsd: '0.00', amountCny: '0.00' }
					: computeDualAmounts(
							shipQty * parseFloat(originalUnitPrice),
							orderCurrency,
							orderRate,
						);

				// 创建发货明细
				const shipmentItem = itemRepo.create({
					id: snowflake.nextId(),
					shipmentId: savedShipment.id,
					orderItemId: dtoItem.orderItemId,
					productId: orderItem.productId,
					productModelId: orderItem.productModelId,
					quantity: dtoItem.quantity,
					salesUnitPriceUsd: unitPrices.unitPriceUsd,
					salesUnitPriceCny: unitPrices.unitPriceCny,
					salesAmountUsd: salesAmounts.amountUsd,
					salesAmountCny: salesAmounts.amountCny,
					totalCostCny: '0',
					totalCostUsd: null,
					grossProfitCny: '0',
					grossProfitUsd: null,
					currency: orderCurrency,
					exchangeRate: orderRate,
				});
				const savedItem = await itemRepo.save(shipmentItem);

				// 4. FIFO 扣减可用库存（传入 manager 保证事务原子性）
				// 无预留模型：订单不冻结库存，发货时按 FIFO 从可用库存扣减，不足则报错
				const fifoResult = await this.fifoService.consume(
					orderItem.productId,
					orderItem.productModelId,
					shipQty,
					savedShipment.id,
					2, // 销售发货
					manager,
					2, // changeType: 出库
				);

				// 5. 写入发货批次明细
				for (const batch of fifoResult.items) {
					const itemBatch = batchRepo.create({
						id: snowflake.nextId(),
						shipmentItemId: savedItem.id,
						inventoryBatchId: batch.batchId,
						quantity: String(batch.quantity),
						unitCostUsd: batch.unitCostUsd,
						totalCostUsd: batch.totalCostUsd,
						unitCostCny: batch.unitCostCny,
						totalCostCny: batch.totalCostCny,
						currency: batch.currency,
						exchangeRate: batch.exchangeRate,
					});
					await batchRepo.save(itemBatch);
				}

				// 6. 汇总成本、计算毛利(CNY + USD)
				savedItem.totalCostCny = fifoResult.totalCostCny;
				savedItem.totalCostUsd = fifoResult.totalCostUsd;
				savedItem.grossProfitCny = (
					parseFloat(salesAmounts.amountCny) -
					parseFloat(fifoResult.totalCostCny)
				).toFixed(2);
				savedItem.grossProfitUsd = (
					parseFloat(salesAmounts.amountUsd) -
					parseFloat(fifoResult.totalCostUsd)
				).toFixed(2);
				await itemRepo.save(savedItem);
			}

			// 7. 更新订单已发数量 + 重算三维状态（传入 manager）
			for (const dtoItem of dto.items) {
				await this.salesOrderService.updateShippedQuantity(
					dto.orderId,
					dtoItem.orderItemId,
					parseFloat(dtoItem.quantity),
					manager,
				);
			}

			// 8. 发货后检查订单是否变为已完成，触发提成计提（仅完成时计提一次）
			const updatedOrder = await manager
				.getRepository(SalesOrder)
				.findOne({
					where: { id: dto.orderId },
				});
			if (
				updatedOrder &&
				updatedOrder.status === 2 &&
				updatedOrder.salespersonId
			) {
				await this.commissionService.accrueOrderCommission(
					dto.orderId,
					manager,
				);
			}

			this.logger.log(`发货完成: ${shipmentNo}, 订单: ${order.orderNo}`);
			return savedShipment;
		});
	}

	/**
	 * 发货预览
	 * 返回订单的可发明细 + FIFO 预估批次消耗
	 */
	async preview(orderId: string) {
		const order = await this.orderRepo.findOne({ where: { id: orderId } });
		if (!order) throw new BadRequestException('订单不存在');

		const orderItems = await this.orderItemRepo.find({
			where: { orderId },
		});

		// 批量查询型号名称
		const modelIds = orderItems
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

		const previewItems = [];
		for (const item of orderItems) {
			// 可发数量 = 有效需求量 - 客户实际持有量
			const qty = parseFloat(item.quantity);
			const shipped = parseFloat(item.shippedQuantity);
			const returned = parseFloat(item.returnedQuantity || '0');
			const refundReturned = parseFloat(
				item.refundReturnedQuantity || '0',
			);
			const effectiveQty = qty - refundReturned;
			const inCustomerHands = Math.max(0, shipped - returned); // L1: 防御性下界
			const remaining = effectiveQty - inCustomerHands;
			if (remaining <= 0) continue;

			// 查询预估 FIFO 批次（按 productModelId 过滤，null 也算独立型号）
			// 无预留模型：展示可用库存批次（与发货 consume 的选取条件一致）
			const batchQb = this.inventoryBatchRepo
				.createQueryBuilder('b')
				.where('b.productId = :productId', {
					productId: item.productId,
				})
				.andWhere('b.status = :status', { status: 1 })
				.andWhere('b.availableQuantity > 0');

			if (item.productModelId) {
				batchQb.andWhere('b.productModelId = :productModelId', {
					productModelId: item.productModelId,
				});
			} else {
				batchQb.andWhere('b.productModelId IS NULL');
			}

			const batches = await batchQb
				.orderBy('b.inboundTime', 'ASC')
				.getMany();

			const batchPreview = [];
			let need = remaining;
			const orderCurrency = order.currency || 'USD';
			for (const batch of batches) {
				if (need <= 0) break;
				const available = parseFloat(batch.availableQuantity);
				const qty = Math.min(available, need);
				// 根据订单币种选择对应的批次成本
				const batchUnitCost =
					orderCurrency === 'CNY'
						? batch.unitCostCny
						: batch.unitCostUsd;
				batchPreview.push({
					batchId: batch.id,
					batchNo: batch.batchNo,
					quantity: qty,
					unitCost: batchUnitCost,
					unitCostUsd: batch.unitCostUsd,
					unitCostCny: batch.unitCostCny,
					totalCost: (qty * parseFloat(batchUnitCost)).toFixed(2),
					totalCostUsd: (
						qty * parseFloat(batch.unitCostUsd || '0')
					).toFixed(2),
					totalCostCny: (qty * parseFloat(batch.unitCostCny)).toFixed(
						2,
					),
				});
				need -= qty;
			}

			previewItems.push({
				...item,
				orderItemId: item.id,
				remainingQuantity: remaining,
				modelName: item.productModelId
					? modelNameMap.get(item.productModelId)
					: undefined,
				batches: batchPreview,
				estimatedCost: batchPreview
					.reduce((s, b) => s + parseFloat(b.totalCost), 0)
					.toFixed(2),
			});
		}

		return {
			...order,
			customerName: order.customerName,
			items: previewItems,
		};
	}

	/**
	 * 查询发货单详情（聚合：主表 + 明细 + 批次）
	 */
	async findOne(id: string) {
		const shipment = await this.shipmentRepo.findOne({ where: { id } });
		if (!shipment) throw new BadRequestException('发货单不存在');

		const items = await this.itemRepo.find({ where: { shipmentId: id } });

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

		// 批量查询商品名称
		const productIds = items
			.map((i) => i.productId)
			.filter((id): id is string => !!id);
		const productNameMap = new Map<string, string>();
		if (productIds.length > 0) {
			const products = await this.dataSource
				.createQueryBuilder()
				.select('p.id, p.product_name')
				.from(Product, 'p')
				.whereInIds(productIds)
				.getRawMany();
			for (const p of products) {
				productNameMap.set(p.id, p.product_name);
			}
		}

		// 批量查询所有明细的批次
		const itemIds = items.map((i) => i.id);
		const allBatches =
			itemIds.length > 0
				? await this.batchRepo.find({
						where: { shipmentItemId: In(itemIds) },
					})
				: [];

		// 批量查询批次号
		const batchIds = [
			...new Set(allBatches.map((b) => b.inventoryBatchId)),
		];
		const batchNoMap = new Map<string, string>();
		if (batchIds.length > 0) {
			const invBatches = await this.inventoryBatchRepo.find({
				where: { id: In(batchIds) },
				select: { id: true, batchNo: true },
			});
			for (const ib of invBatches) {
				batchNoMap.set(ib.id, ib.batchNo);
			}
		}

		// 按 shipmentItemId 分组，附加 batchNo
		const batchMap = new Map<string, any[]>();
		for (const b of allBatches) {
			if (!batchMap.has(b.shipmentItemId))
				batchMap.set(b.shipmentItemId, []);
			batchMap.get(b.shipmentItemId)!.push({
				...b,
				batchNo: batchNoMap.get(b.inventoryBatchId),
			});
		}

		// 联表查询每个明细的已退数量
		const returnedQtyMap = new Map<string, number>();
		if (itemIds.length > 0) {
			const returnAgg = await this.dataSource
				.createQueryBuilder()
				.select('ri.shipment_item_id', 'shipmentItemId')
				.addSelect('SUM(ri.quantity)', 'totalReturned')
				.from(SalesReturnItem, 'ri')
				.where('ri.shipment_item_id IN (:...itemIds)', { itemIds })
				.groupBy('ri.shipment_item_id')
				.getRawMany();
			for (const r of returnAgg) {
				returnedQtyMap.set(
					r.shipmentItemId,
					parseFloat(r.totalReturned),
				);
			}
		}

		const itemsWithBatches = items.map((item) => ({
			...item,
			productName: productNameMap.get(item.productId) || undefined,
			modelName: item.productModelId
				? modelNameMap.get(item.productModelId)
				: undefined,
			returnedQty: returnedQtyMap.get(item.id) || 0,
			batches: batchMap.get(item.id) || [],
		}));

		return { ...shipment, items: itemsWithBatches };
	}

	/**
	 * 分页查询发货单列表
	 */
	async findAll(query: QueryShipmentDto) {
		const page = query.page || 1;
		const pageSize = query.pageSize || 20;

		const qb = this.shipmentRepo
			.createQueryBuilder('s')
			.leftJoin(SalesOrder, 'o', 'o.id = s.order_id')
			.addSelect('o.order_no', 'orderNo');

		if (query.shipmentNo) {
			qb.andWhere('s.shipmentNo LIKE :no', {
				no: `%${query.shipmentNo}%`,
			});
		}
		if (query.orderId) {
			qb.andWhere('s.orderId = :orderId', { orderId: query.orderId });
		}
    if (query.orderNo) {
			qb.andWhere('o.orderNo = :orderNo', { orderNo: query.orderNo });
		}
		if (query.expressCompanyId) {
			qb.andWhere('s.expressCompanyId = :expressCompanyId', {
				expressCompanyId: query.expressCompanyId,
			});
		}
		if (query.trackingNo) {
			qb.andWhere('s.trackingNo LIKE :trackingNo', {
				trackingNo: `%${query.trackingNo}%`,
			});
		}
		if (query.startDate) {
			qb.andWhere('s.shipmentDate >= :startDate', {
				startDate: query.startDate,
			});
		}
		if (query.endDate) {
			qb.andWhere('s.shipmentDate <= :endDate', {
				endDate: query.endDate,
			});
		}

		const sortField = query.sortField || 'createdTime';
		const sortOrder = query.sortOrder || 'DESC';
		qb.orderBy(`s.${sortField}`, sortOrder)
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
