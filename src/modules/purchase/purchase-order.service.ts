import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { snowflake } from '@/common/utils/snowflake';
import type {
	CreatePurchaseOrderDto,
	UpdatePurchaseOrderDto,
	QueryPurchaseOrderDto,
} from './dto/purchase-order.dto';
import { RateService } from '@/common/rate/rate.service';

/**
 * 采购单服务
 * 负责采购单的 CRUD、状态管理
 */
@Injectable()
export class PurchaseOrderService {
	constructor(
		@InjectRepository(PurchaseOrder)
		private readonly orderRepo: Repository<PurchaseOrder>,
		@InjectRepository(PurchaseOrderItem)
		private readonly itemRepo: Repository<PurchaseOrderItem>,
		private readonly sequenceService: SequenceService,
		private readonly rateService: RateService,
		private readonly dataSource: DataSource,
	) {}

	/**
	 * 创建采购单
	 * 生成采购单号（CG前缀），创建主表和明细
	 */
	async create(dto: CreatePurchaseOrderDto): Promise<PurchaseOrder> {
		if (!dto.items || dto.items.length === 0) {
			throw new BadRequestException('采购明细不能为空');
		}

		const purchaseNo = await this.sequenceService.generate('CG');

		// 计算总金额
		let totalAmount = 0;
		const items = dto.items.map((item) => {
			const qty = parseFloat(item.quantity);
			const price = parseFloat(item.unitPrice);
			if (qty <= 0) throw new BadRequestException('采购数量必须大于零');
			if (price <= 0) throw new BadRequestException('采购单价必须大于零');
			const amount = qty * price;
			totalAmount += amount;
			return {
				id: snowflake.nextId(),
				productId: item.productId,
				productModelId: item.productModelId || null,
				quantity: item.quantity,
				unitPrice: item.unitPrice,
				amount: amount.toFixed(2),
				receivedQuantity: '0',
				returnedQuantity: '0',
			};
		});

		const exchangeRate = await this.rateService.getRate({
			date: dto.purchaseDate,
			base: 'USD',
			quotes: 'CNY',
		});

		return this.dataSource.transaction(async (manager: EntityManager) => {
			const orderRepo = manager.getRepository(PurchaseOrder);
			const itemRepo = manager.getRepository(PurchaseOrderItem);

			// 保存主表
			const order = orderRepo.create({
				id: snowflake.nextId(),
				purchaseNo,
				supplierId: dto.supplierId,
				currency: dto.currency || 'CNY',
				exchangeRate,
				totalAmount: totalAmount.toFixed(2),
				purchaseDate: new Date(dto.purchaseDate),
				status: 1,
				remark: dto.remark || null,
			});
			const savedOrder = await orderRepo.save(order);

			// 保存明细
			const savedItems = items.map((item) =>
				itemRepo.create({ ...item, purchaseOrderId: savedOrder.id }),
			);
			await itemRepo.save(savedItems);

			return savedOrder;
		});
	}

	/**
	 * 更新采购单（仅待入库状态可修改）
	 */
	async update(
		id: string,
		dto: UpdatePurchaseOrderDto,
	): Promise<PurchaseOrder> {
		let order = await this.findOne(id);
		if (order.status !== 1) {
			throw new BadRequestException('仅待入库状态的采购单可以修改');
		}

		const exchangeRate = await this.rateService.getRate({
			date: dto.purchaseDate || (order.purchaseDate instanceof Date
				? order.purchaseDate.toISOString().slice(0, 10)
				: order.purchaseDate),
			base: 'USD',
			quotes: 'CNY',
		});

		const {
			items: _items,
			purchaseDate,
			...restDto
		} = dto as UpdatePurchaseOrderDto & Record<string, unknown>;
		order = { ...order, ...restDto, exchangeRate };
		if (purchaseDate) {
			order.purchaseDate = new Date(purchaseDate);
		}

		return this.dataSource.transaction(async (manager: EntityManager) => {
			const orderRepo = manager.getRepository(PurchaseOrder);
			const itemRepo = manager.getRepository(PurchaseOrderItem);

			// 如果提供了新的明细，整体替换
			if (dto.items && dto.items.length > 0) {
				// 删除旧明细
				await itemRepo.delete({ purchaseOrderId: id });

				// 重新计算总金额
				let totalAmount = 0;
				const items = dto.items.map((item) => {
					const qty = parseFloat(item.quantity);
					const price = parseFloat(item.unitPrice);
					if (qty <= 0)
						throw new BadRequestException('采购数量必须大于零');

					if (price <= 0)
						throw new BadRequestException('采购单价必须大于零');

					const amount = qty * price;
					totalAmount += amount;

					return itemRepo.create({
						id: snowflake.nextId(),
						purchaseOrderId: id,
						productId: item.productId,
						productModelId: item.productModelId || null,
						quantity: item.quantity,
						unitPrice: item.unitPrice,
						amount: amount.toFixed(2),
						receivedQuantity: '0',
						returnedQuantity: '0',
					});
				});

				await itemRepo.save(items);
			}

			return orderRepo.save(order);
		});
	}

	/**
	 * 查询采购单详情（含明细）
	 */
	async findOne(
		id: string,
	): Promise<PurchaseOrder & { items?: PurchaseOrderItem[] }> {
		const order = await this.orderRepo.findOne({ where: { id } });
		if (!order) {
			throw new BadRequestException('采购单不存在');
		}
		const items = await this.itemRepo.find({
			where: { purchaseOrderId: id },
		});
		return { ...order, items };
	}

	/**
	 * 分页查询采购单列表
	 */
	async findAll(query: QueryPurchaseOrderDto) {
		const page = query.page || 1;
		const pageSize = query.pageSize || 20;

		const qb = this.orderRepo.createQueryBuilder('po');

		if (query.purchaseNo) {
			qb.andWhere('po.purchaseNo LIKE :no', {
				no: `%${query.purchaseNo}%`,
			});
		}
		if (query.supplierId) {
			qb.andWhere('po.supplierId = :supplierId', {
				supplierId: query.supplierId,
			});
		}
		if (query.status !== undefined) {
			qb.andWhere('po.status = :status', { status: query.status });
		}

		qb.orderBy('po.createdTime', 'DESC')
			.skip((page - 1) * pageSize)
			.take(pageSize);

		const [list, total] = await qb.getManyAndCount();
		return { list, total, page, pageSize };
	}

	/**
	 * 关闭采购单
	 */
	async close(id: string): Promise<PurchaseOrder> {
		const order = await this.orderRepo.findOne({ where: { id } });
		if (!order) throw new BadRequestException('采购单不存在');
		if (order.status === 3)
			throw new BadRequestException('已全部入库，无需关闭');
		if (order.status === 4) throw new BadRequestException('采购单已关闭');

		order.status = 4;
		return this.orderRepo.save(order);
	}

	/**
	 * 重新计算采购单状态（入库后调用）
	 * 1=待入库 → 2=部分入库 → 3=全部入库
	 */
	async recalculateStatus(orderId: string): Promise<void> {
		const items = await this.itemRepo.find({
			where: { purchaseOrderId: orderId },
		});
		if (items.length === 0) return;

		let allReceived = true;
		let anyReceived = false;

		for (const item of items) {
			const qty = parseFloat(item.quantity);
			const received = parseFloat(item.receivedQuantity);
			if (received > 0) anyReceived = true;
			if (received < qty) allReceived = false;
		}

		const order = await this.orderRepo.findOne({ where: { id: orderId } });
		if (!order || order.status === 4) return;

		if (allReceived) {
			order.status = 3; // 全部入库
		} else if (anyReceived) {
			order.status = 2; // 部分入库
		} else {
			order.status = 1; // 待入库
		}

		await this.orderRepo.save(order);
	}

	/**
	 * 重新计算采购单退货状态（退货后调用）
	 * 1=未退货 → 2=部分退货 → 3=全部退货
	 */
	async recalculateReturnStatus(orderId: string): Promise<void> {
		const items = await this.itemRepo.find({
			where: { purchaseOrderId: orderId },
		});
		if (items.length === 0) return;

		let anyReturned = false;
		let allReturned = true;

		for (const item of items) {
			const received = parseFloat(item.receivedQuantity);
			const returned = parseFloat(item.returnedQuantity);
			if (returned > 0) anyReturned = true;
			if (received > 0 && returned < received) allReturned = false;
			// 未入库的明细不参与"全部退货"判断
			if (received === 0) {
				// 没入库就不可能退货，忽略此项
			}
		}

		// 如果没有入库过任何商品，视为未退货
		const hasAnyReceived = items.some(
			(item) => parseFloat(item.receivedQuantity) > 0,
		);
		if (!hasAnyReceived) {
			allReturned = false;
		}

		const order = await this.orderRepo.findOne({ where: { id: orderId } });
		if (!order) return;

		if (!anyReturned) {
			order.returnStatus = 1; // 未退货
		} else if (allReturned) {
			order.returnStatus = 3; // 全部退货
		} else {
			order.returnStatus = 2; // 部分退货
		}

		await this.orderRepo.save(order);
	}

	/** 获取采购单 Repository */
	getOrderRepo(): Repository<PurchaseOrder> {
		return this.orderRepo;
	}

	/** 获取采购明细 Repository */
	getItemRepo(): Repository<PurchaseOrderItem> {
		return this.itemRepo;
	}
}
