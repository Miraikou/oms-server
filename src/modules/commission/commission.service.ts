import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { CommissionLedger } from './entities/commission-ledger.entity';
import { CommissionSettlement } from './entities/commission-settlement.entity';
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity';
import { SalesOrderCost } from '@/modules/sales-order/entities/sales-order-cost.entity';
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity';
import { snowflake } from '@/common/utils/snowflake';
import type {
	QueryLedgerDto,
	QuerySettlementDto,
} from './dto/commission.dto';

/**
 * 提成服务 ⭐
 * 核心方法：accrueOrderCommission（订单完成计提）、recalculateOrderCommission（退款/退货冲回）、settleMonth（月度结算）
 */
@Injectable()
export class CommissionService {
	private readonly logger = new Logger(CommissionService.name);

	constructor(
		@InjectRepository(CommissionLedger)
		private readonly ledgerRepo: Repository<CommissionLedger>,
		@InjectRepository(CommissionSettlement)
		private readonly settlementRepo: Repository<CommissionSettlement>,
		@InjectRepository(Salesperson)
		private readonly salespersonRepo: Repository<Salesperson>,
		@InjectRepository(SalesOrder)
		private readonly orderRepo: Repository<SalesOrder>,
		@InjectRepository(SalesOrderItem)
		private readonly orderItemRepo: Repository<SalesOrderItem>,
		@InjectRepository(SalesOrderCost)
		private readonly costRepo: Repository<SalesOrderCost>,
		@InjectRepository(ShipmentItem)
		private readonly shipmentItemRepo: Repository<ShipmentItem>,
		private readonly dataSource: DataSource,
		private readonly configService: ConfigService,
	) {}

	/**
	 * 订单完成时计提提成 ⭐
	 * 仅在订单 status 变为 2（已完成）时调用，每个订单只计提一次
	 * 公式：提成 = 订单利润 × 提成比例
	 */
	async accrueOrderCommission(
		orderId: string,
		manager?: EntityManager,
	): Promise<CommissionLedger | null> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;

		// 幂等校验：该订单是否已有计提分录
		const existing = await ledgerRepo.findOne({
			where: { salesOrderId: orderId, type: 1 },
		});
		if (existing) return null;

		// 加载订单
		const orderRepo = manager
			? manager.getRepository(SalesOrder)
			: this.orderRepo;
		const order = await orderRepo.findOne({ where: { id: orderId } });
		if (!order || order.status !== 2 || !order.salespersonId) return null;

		// 计算订单利润（与 getProfitSummary 逻辑完全一致）
		const profit = await this.calcOrderProfit(orderId, manager);

		// 获取销售员提成比例
		const spRepo = manager
			? manager.getRepository(Salesperson)
			: this.salespersonRepo;
		const salesperson = await spRepo.findOne({
			where: { id: order.salespersonId },
		});
		if (!salesperson || salesperson.status !== 1) return null;

		const rate = parseFloat(salesperson.commissionRate || String(this.configService.get<number>('DEFAULT_COMMISSION_RATE', 40)));
		if (rate <= 0) return null;

		// 利润为负时提成为 0
		const baseUsd = Math.max(0, profit.salesProfitUsd);
		const baseCny = Math.max(0, profit.salesProfitCny);
		const commissionAmountUsd = this.calcCommission(String(baseUsd), rate);
		const commissionAmountCny = this.calcCommission(String(baseCny), rate);

		const ledger = ledgerRepo.create({
			id: snowflake.nextId(),
			salespersonId: order.salespersonId,
			salesOrderId: orderId,
			paymentId: null,
			type: 1, // 计提
			status: 1, // 待结算
			orderAmountUsd: order.totalAmountUsd,
			orderAmountCny: order.totalAmountCny,
			receivedAmountUsd: order.receivedAmountUsd,
			receivedAmountCny: order.receivedAmountCny,
			profitBaseUsd: profit.salesProfitUsd.toFixed(2),
			profitBaseCny: profit.salesProfitCny.toFixed(2),
			revenueAdjustmentUsd: '0',
			revenueAdjustmentCny: '0',
			commissionRate: salesperson.commissionRate,
			commissionAmountUsd,
			commissionAmountCny,
			currency: order.currency || 'USD',
			exchangeRate: order.exchangeRate,
			remark: '订单完成计提',
		});

		const saved = await ledgerRepo.save(ledger);
		this.logger.log(
			`提成计提: 销售员 ${salesperson.name}, 订单 ${orderId}, ` +
			`利润 ${profit.salesProfitCny.toFixed(2)} CNY, 提成 ${commissionAmountCny} CNY`,
		);
		return saved;
	}

	/**
	 * 退款/退货后重算提成差额并生成冲回分录 ⭐
	 *
	 * 核心逻辑：
	 * 1. 读取该订单的原始计提分录（type=1）
	 * 2. 计算当前利润（退货场景：成本已变化；退款场景：收入减少）
	 * 3. 调整后利润 = 当前利润 - 累计退款额
	 * 4. 差额 = 原提成 - 调整后提成 - 已冲回金额 → 生成本次冲回分录
	 *
	 * 支持多次退款/退货：每次基于累计调整量计算，不会重复扣减
	 */
	async recalculateOrderCommission(
		orderId: string,
		refundAmountUsd: string,
		refundAmountCny: string,
		paymentId: string,
		salesReturnId: string,
		manager?: EntityManager,
	): Promise<CommissionLedger | null> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;

		// 1. 查找该订单的计提分录（不存在 = 订单未完成，无需冲回）
		const accrualEntry = await ledgerRepo.findOne({
			where: { salesOrderId: orderId, type: 1 },
		});
		if (!accrualEntry) return null;

		// 2. 累计收入调整（退款减少收入）
		const currentAdjUsd = parseFloat(
			accrualEntry.revenueAdjustmentUsd || '0',
		);
		const currentAdjCny = parseFloat(
			accrualEntry.revenueAdjustmentCny || '0',
		);
		const newAdjUsd = currentAdjUsd + parseFloat(refundAmountUsd);
		const newAdjCny = currentAdjCny + parseFloat(refundAmountCny);

		// 3. 获取订单和当前利润
		const orderRepo = manager
			? manager.getRepository(SalesOrder)
			: this.orderRepo;
		const order = await orderRepo.findOne({ where: { id: orderId } });
		if (!order) return null;

		const profit = await this.calcOrderProfit(orderId, manager);

		// 4. 调整利润 = 当前利润 - 累计退款额（退款相当于减少收入）
		const adjustedProfitCny = profit.salesProfitCny - newAdjCny;
		const adjustedProfitUsd = profit.salesProfitUsd - newAdjUsd;

		// 5. 计算应有提成 vs 已计提提成
		const rate = parseFloat(accrualEntry.commissionRate || '0');
		const originalCommissionCny = parseFloat(
			accrualEntry.commissionAmountCny,
		);
		const originalCommissionUsd = parseFloat(
			accrualEntry.commissionAmountUsd,
		);

		const newCommissionCny = this.calcCommission(
			String(Math.max(0, adjustedProfitCny)),
			rate,
		);
		const newCommissionUsd = this.calcCommission(
			String(Math.max(0, adjustedProfitUsd)),
			rate,
		);

		// 6. 减去之前已冲回的金额，避免重复扣减
		const previousClawbackCny = await this.getTotalClawbackForOrder(
			orderId,
			manager,
		);
		const previousClawbackUsd = await this.getTotalClawbackForOrderUsd(
			orderId,
			manager,
		);

		const totalShouldClawbackCny =
			originalCommissionCny - parseFloat(newCommissionCny);
		const totalShouldClawbackUsd =
			originalCommissionUsd - parseFloat(newCommissionUsd);

		const clawbackCny = totalShouldClawbackCny - previousClawbackCny;
		const clawbackUsd = totalShouldClawbackUsd - previousClawbackUsd;

		// 差额极小（精度误差）时不生成冲回
		if (Math.abs(clawbackCny) < 0.01 && Math.abs(clawbackUsd) < 0.01) {
			return null;
		}

		// 7. 创建冲回分录
		const ledger = ledgerRepo.create({
			id: snowflake.nextId(),
			salespersonId: accrualEntry.salespersonId,
			salesOrderId: orderId,
			paymentId: paymentId || null,
			salesReturnId: salesReturnId || null,
			type: 2, // 冲回
			status: 1, // 待结算
			orderAmountUsd: order.totalAmountUsd,
			orderAmountCny: order.totalAmountCny,
			receivedAmountUsd: `-${refundAmountUsd}`,
			receivedAmountCny: `-${refundAmountCny}`,
			profitBaseUsd: adjustedProfitUsd.toFixed(2),
			profitBaseCny: adjustedProfitCny.toFixed(2),
			revenueAdjustmentUsd: newAdjUsd.toFixed(2),
			revenueAdjustmentCny: newAdjCny.toFixed(2),
			commissionRate: accrualEntry.commissionRate,
			commissionAmountUsd: `-${Math.abs(clawbackUsd).toFixed(2)}`,
			commissionAmountCny: `-${Math.abs(clawbackCny).toFixed(2)}`,
			currency: order.currency || 'USD',
			exchangeRate: order.exchangeRate,
			remark: salesReturnId ? '退货重算冲回' : '退款重算冲回',
		});

		const saved = await ledgerRepo.save(ledger);

		// 8. 更新原计提分录的收入调整字段
		accrualEntry.revenueAdjustmentUsd = newAdjUsd.toFixed(2);
		accrualEntry.revenueAdjustmentCny = newAdjCny.toFixed(2);
		await ledgerRepo.save(accrualEntry);

		this.logger.log(
			`提成冲回: 订单 ${orderId}, 冲回 ${clawbackCny.toFixed(2)} CNY, ` +
			`累计调整 ${newAdjCny.toFixed(2)} CNY`,
		);
		return saved;
	}

	/**
	 * 月度结算 ⭐
	 * 汇总当月所有待结算分录，生成结算记录
	 */
	async settleMonth(month: string): Promise<CommissionSettlement[]> {
		// 校验月份格式
		if (!/^\d{4}-\d{2}$/.test(month)) {
			throw new BadRequestException('月份格式错误，应为 YYYY-MM');
		}

		const results: CommissionSettlement[] = [];

		// 查询所有有当月待结算分录的销售员
		const salespersons = await this.dataSource.query(
			`SELECT DISTINCT salesperson_id FROM commission_ledger 
			 WHERE status = 1 AND DATE_FORMAT(created_time, '%Y-%m') = ?`,
			[month],
		);

		for (const { salesperson_id } of salespersons) {
			// 计提总额（type=1）
			const earnedResult = await this.dataSource.query(
				`SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
				        COALESCE(SUM(commission_amount_usd), 0) AS totalUsd,
				        COUNT(DISTINCT sales_order_id) AS order_count
				 FROM commission_ledger
				 WHERE salesperson_id = ? AND status = 1 AND type = 1
				   AND DATE_FORMAT(created_time, '%Y-%m') = ?`,
				[salesperson_id, month],
			);

			// 冲回总额（type=2，取绝对值）
			const clawbackResult = await this.dataSource.query(
				`SELECT COALESCE(SUM(ABS(commission_amount_cny)), 0) AS total,
				        COALESCE(SUM(ABS(commission_amount_usd)), 0) AS totalUsd,
				        COUNT(*) AS clawback_count
				 FROM commission_ledger
				 WHERE salesperson_id = ? AND status = 1 AND type = 2
				   AND DATE_FORMAT(created_time, '%Y-%m') = ?`,
				[salesperson_id, month],
			);

			const totalEarned = parseFloat(earnedResult[0].total || '0');
			const totalEarnedUsd = parseFloat(earnedResult[0].totalUsd || '0');
			const orderCount = parseInt(earnedResult[0].order_count || '0');
			const totalClawback = parseFloat(
				clawbackResult[0].total || '0',
			);
			const totalClawbackUsd = parseFloat(
				clawbackResult[0].totalUsd || '0',
			);
			const clawbackCount = parseInt(
				clawbackResult[0].clawback_count || '0',
			);

			// 上月结余（负数余额）
			const previousBalance = await this.getPreviousBalance(
				salesperson_id,
				month,
			);
			const previousBalanceUsd = await this.getPreviousBalanceUsd(
				salesperson_id,
				month,
			);

			// 净提成 = 计提 - 冲回 + 上月结余
			const netCommission =
				totalEarned - totalClawback + previousBalance;
			const netCommissionUsd =
				totalEarnedUsd - totalClawbackUsd + previousBalanceUsd;

			// 创建结算记录
			const settlement = this.settlementRepo.create({
				id: snowflake.nextId(),
				salespersonId: salesperson_id,
				settleMonth: month,
				totalEarned: totalEarned.toFixed(2),
				totalEarnedUsd: totalEarnedUsd.toFixed(2),
				totalClawback: totalClawback.toFixed(2),
				totalClawbackUsd: totalClawbackUsd.toFixed(2),
				previousBalance: previousBalance.toFixed(2),
				previousBalanceUsd: previousBalanceUsd.toFixed(2),
				netCommission: netCommission.toFixed(2),
				netCommissionUsd: netCommissionUsd.toFixed(2),
				orderCount,
				clawbackCount,
				status: 1, // 待确认
			});
			await this.settlementRepo.save(settlement);

			// 标记分录为已结算
			await this.dataSource.query(
				`UPDATE commission_ledger 
				 SET status = 2, settle_month = ?, settle_time = NOW()
				 WHERE salesperson_id = ? AND status = 1 
				   AND DATE_FORMAT(created_time, '%Y-%m') = ?`,
				[month, salesperson_id, month],
			);

			results.push(settlement);
		}

		this.logger.log(
			`月度结算完成: ${month}, 共 ${results.length} 个销售员`,
		);
		return results;
	}

	/**
	 * 确认发放
	 */
	async confirmSettlement(
		id: string,
		paidAmount: string,
	): Promise<CommissionSettlement> {
		const settlement = await this.settlementRepo.findOne({
			where: { id },
		});
		if (!settlement) throw new BadRequestException('结算记录不存在');
		if (settlement.status !== 1) {
			throw new BadRequestException('该结算记录已处理');
		}

		settlement.status = 2; // 已发放
		settlement.paidAmount = paidAmount;
		settlement.paidTime = new Date();
		return this.settlementRepo.save(settlement);
	}

	/**
	 * 查询提成分录列表
	 */
	async findLedger(query: QueryLedgerDto) {
		const page = query.page || 1;
		const pageSize = query.pageSize || 20;

		const qb = this.ledgerRepo
			.createQueryBuilder('l')
			.leftJoin(
				'salesperson',
				'sp',
				'sp.id = l.salesperson_id',
			)
			.addSelect('sp.name', 'salespersonName')
			.leftJoin('sales_order', 'so', 'so.id = l.sales_order_id')
			.addSelect('so.order_no', 'orderNo');

		if (query.salespersonId) {
			qb.andWhere('l.salespersonId = :salespersonId', {
				salespersonId: query.salespersonId,
			});
		}
		if (query.salesOrderId) {
			qb.andWhere('l.salesOrderId = :salesOrderId', {
				salesOrderId: query.salesOrderId,
			});
		}
		if (query.type !== undefined) {
			qb.andWhere('l.type = :type', { type: query.type });
		}
		if (query.status !== undefined) {
			qb.andWhere('l.status = :status', { status: query.status });
		}
		if (query.settleMonth) {
			qb.andWhere('l.settleMonth = :settleMonth', {
				settleMonth: query.settleMonth,
			});
		}
		if (query.startDate) {
			qb.andWhere('l.createdTime >= :startDate', {
				startDate: query.startDate,
			});
		}
		if (query.endDate) {
			qb.andWhere('l.createdTime <= :endDate', {
				endDate: query.endDate,
			});
		}

		qb.orderBy('l.createdTime', 'DESC')
			.skip((page - 1) * pageSize)
			.take(pageSize);

		const { entities, raw } = await qb.getRawAndEntities();
		const list = entities.map((entity, i) => ({
			...entity,
			salespersonName: raw[i]?.salespersonName || null,
			orderNo: raw[i]?.orderNo || null,
		}));

		return { list, total: await qb.getCount(), page, pageSize };
	}

	/**
	 * 查询结算记录列表
	 */
	async findSettlement(query: QuerySettlementDto) {
		const page = query.page || 1;
		const pageSize = query.pageSize || 20;

		const qb = this.settlementRepo
			.createQueryBuilder('s')
			.leftJoin(
				'salesperson',
				'sp',
				'sp.id = s.salesperson_id',
			)
			.addSelect('sp.name', 'salespersonName');

		if (query.salespersonId) {
			qb.andWhere('s.salespersonId = :salespersonId', {
				salespersonId: query.salespersonId,
			});
		}
		if (query.settleMonth) {
			qb.andWhere('s.settleMonth = :settleMonth', {
				settleMonth: query.settleMonth,
			});
		}
		if (query.status !== undefined) {
			qb.andWhere('s.status = :status', { status: query.status });
		}

		qb.orderBy('s.settleMonth', 'DESC')
			.addOrderBy('s.createdTime', 'DESC')
			.skip((page - 1) * pageSize)
			.take(pageSize);

		const { entities, raw } = await qb.getRawAndEntities();
		const list = entities.map((entity, i) => ({
			...entity,
			salespersonName: raw[i]?.salespersonName || null,
		}));

		return { list, total: await qb.getCount(), page, pageSize };
	}

	/**
	 * 提成汇总统计
	 */
	async getSummary(startDate?: string, endDate?: string) {
		const params: unknown[] = [];
		let dateFilter = '';
		if (startDate && endDate) {
			dateFilter = 'AND created_time >= ? AND created_time <= ?';
			params.push(startDate, endDate);
		}

		// 当月计提总额
		const earned = await this.dataSource.query(
			`SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
			        COALESCE(SUM(commission_amount_usd), 0) AS totalUsd
			 FROM commission_ledger WHERE type = 1 ${dateFilter}`,
			params,
		);

		// 当月冲回总额
		const clawback = await this.dataSource.query(
			`SELECT COALESCE(SUM(ABS(commission_amount_cny)), 0) AS total,
			        COALESCE(SUM(ABS(commission_amount_usd)), 0) AS totalUsd
			 FROM commission_ledger WHERE type = 2 ${dateFilter}`,
			params,
		);

		// 待结算总额（所有未结算的）
		const pending = await this.dataSource.query(
			`SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
			        COALESCE(SUM(commission_amount_usd), 0) AS totalUsd
			 FROM commission_ledger WHERE status = 1`,
		);

		const monthEarned = parseFloat(earned[0]?.total || '0');
		const monthEarnedUsd = parseFloat(earned[0]?.totalUsd || '0');
		const monthClawback = parseFloat(clawback[0]?.total || '0');
		const monthClawbackUsd = parseFloat(clawback[0]?.totalUsd || '0');

		return {
			monthEarned,
			monthEarnedUsd,
			monthClawback,
			monthClawbackUsd,
			monthNet: (monthEarned - monthClawback).toFixed(2),
			monthNetUsd: (monthEarnedUsd - monthClawbackUsd).toFixed(2),
			totalPending: parseFloat(pending[0]?.total || '0'),
			totalPendingUsd: parseFloat(pending[0]?.totalUsd || '0'),
		};
	}

	/**
	 * 按销售员汇总提成
	 */
	async getSalespersonSummary(
		startDate?: string,
		endDate?: string,
	) {
		const params: unknown[] = [];
		let dateFilter = '';
		if (startDate && endDate) {
			dateFilter = 'AND l.created_time >= ? AND l.created_time <= ?';
			params.push(startDate, endDate);
		}

		return this.dataSource.query(
			`SELECT
				l.salesperson_id AS salespersonId,
				sp.name AS salespersonName,
				sp.commission_rate AS commissionRate,
				COALESCE(SUM(CASE WHEN l.type = 1 THEN l.commission_amount_cny ELSE 0 END), 0) AS totalEarned,
				COALESCE(SUM(CASE WHEN l.type = 1 THEN l.commission_amount_usd ELSE 0 END), 0) AS totalEarnedUsd,
				COALESCE(SUM(CASE WHEN l.type = 2 THEN ABS(l.commission_amount_cny) ELSE 0 END), 0) AS totalClawback,
				COALESCE(SUM(CASE WHEN l.type = 2 THEN ABS(l.commission_amount_usd) ELSE 0 END), 0) AS totalClawbackUsd,
				COALESCE(SUM(l.commission_amount_cny), 0) AS netCommission,
				COALESCE(SUM(l.commission_amount_usd), 0) AS netCommissionUsd
			 FROM commission_ledger l
			 LEFT JOIN salesperson sp ON sp.id = l.salesperson_id
			 WHERE 1=1 ${dateFilter}
			 GROUP BY l.salesperson_id, sp.name, sp.commission_rate
			 ORDER BY netCommission DESC`,
			params,
		);
	}

	/**
	 * 按订单 ID 批量查询销售员提成汇总
	 * @param orderIds 订单 ID 数组
	 * @returns Map<orderId, { commissionUsd, commissionCny }>
	 */
	async getCommissionByOrderIds(
		orderIds: string[],
	): Promise<Map<string, { commissionUsd: string; commissionCny: string }>> {
		const result = new Map<string, { commissionUsd: string; commissionCny: string }>();
		if (orderIds.length === 0) return result;

		const rows = await this.dataSource.query(
			`SELECT sales_order_id AS orderId,
			        COALESCE(SUM(commission_amount_usd), 0) AS commissionUsd,
			        COALESCE(SUM(commission_amount_cny), 0) AS commissionCny
			 FROM commission_ledger
			 WHERE sales_order_id IN (?)
			 GROUP BY sales_order_id`,
			[orderIds],
		);

		for (const row of rows) {
			result.set(row.orderId, {
				commissionUsd: parseFloat(row.commissionUsd || '0').toFixed(2),
				commissionCny: parseFloat(row.commissionCny || '0').toFixed(2),
			});
		}

		return result;
	}

	// ==================== 私有方法 ====================

	/** 计算提成金额 */
	private calcCommission(baseAmount: string, rate: number): string {
		const amount = parseFloat(baseAmount);
		return ((amount * rate) / 100).toFixed(2);
	}

	/**
	 * 计算订单利润（事务安全版本）
	 * 公式：销售利润 = 订单金额 - 博主佣金 - 产品成本(FIFO) - 额外成本
	 *
	 * ⚠️ 必须与 sales-order.service.getProfitSummary() 保持公式一致
	 */
	private async calcOrderProfit(
		orderId: string,
		manager?: EntityManager,
	): Promise<{
		totalAmountCny: number;
		totalAmountUsd: number;
		productCostCny: number;
		productCostUsd: number;
		extraCostCny: number;
		extraCostUsd: number;
		bloggerCommissionCny: number;
		bloggerCommissionUsd: number;
		salesProfitCny: number;
		salesProfitUsd: number;
		exchangeRate: number;
	}> {
		const orderRepo = manager
			? manager.getRepository(SalesOrder)
			: this.orderRepo;
		const order = await orderRepo.findOne({ where: { id: orderId } });
		if (!order) {
			throw new BadRequestException('订单不存在');
		}

		const exchangeRate = parseFloat(order.exchangeRate || '7');

		// 产品成本（FIFO，来自 shipment_item.total_cost_cny/usd）
		const shipItemRepo = manager
			? manager.getRepository(ShipmentItem)
			: this.shipmentItemRepo;
		const costResult = await shipItemRepo
			.createQueryBuilder('si')
			.innerJoin('shipment', 's', 's.id = si.shipment_id')
			.select('COALESCE(SUM(si.total_cost_cny), 0)', 'totalCostCny')
			.addSelect('COALESCE(SUM(si.total_cost_usd), 0)', 'totalCostUsd')
			.where('s.order_id = :orderId', { orderId })
			.getRawOne();
		const productCostCny = parseFloat(costResult?.totalCostCny || '0');
		const productCostUsd = parseFloat(costResult?.totalCostUsd || '0');

		// 额外成本（来自 sales_order_cost）
		const costRepo = manager
			? manager.getRepository(SalesOrderCost)
			: this.costRepo;
		const extraCostResult = await costRepo
			.createQueryBuilder('c')
			.select('COALESCE(SUM(c.amount_cny), 0)', 'totalCny')
			.addSelect('COALESCE(SUM(c.amount_usd), 0)', 'totalUsd')
			.where('c.order_id = :orderId', { orderId })
			.getRawOne();
		const extraCostCny = parseFloat(extraCostResult?.totalCny || '0');
		const extraCostUsd = parseFloat(extraCostResult?.totalUsd || '0');

		// 博主佣金（与 getProfitSummary 一致：totalAmount × rate / 100）
		const totalAmountCny = parseFloat(order.totalAmountCny || '0');
		const totalAmountUsd = parseFloat(order.totalAmountUsd || '0');
		const bloggerRate = parseFloat(order.bloggerCommissionRate || '0');
		const bloggerCommissionCny = totalAmountCny * bloggerRate / 100;
		const bloggerCommissionUsd = totalAmountUsd * bloggerRate / 100;

		// 销售利润
		const salesProfitCny = totalAmountCny - bloggerCommissionCny
			- productCostCny - extraCostCny;
		const salesProfitUsd = totalAmountUsd - bloggerCommissionUsd
			- productCostUsd - extraCostUsd;

		return {
			totalAmountCny,
			totalAmountUsd,
			productCostCny,
			productCostUsd,
			extraCostCny,
			extraCostUsd,
			bloggerCommissionCny,
			bloggerCommissionUsd,
			salesProfitCny,
			salesProfitUsd,
			exchangeRate,
		};
	}

	/** 查询订单已有冲回总额（CNY） */
	private async getTotalClawbackForOrder(
		orderId: string,
		manager?: EntityManager,
	): Promise<number> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;
		const result = await ledgerRepo
			.createQueryBuilder('l')
			.select('COALESCE(SUM(ABS(l.commission_amount_cny)), 0)', 'total')
			.where('l.sales_order_id = :orderId', { orderId })
			.andWhere('l.type = 2')
			.getRawOne();
		return parseFloat(result?.total || '0');
	}

	/** 查询订单已有冲回总额（USD） */
	private async getTotalClawbackForOrderUsd(
		orderId: string,
		manager?: EntityManager,
	): Promise<number> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;
		const result = await ledgerRepo
			.createQueryBuilder('l')
			.select('COALESCE(SUM(ABS(l.commission_amount_usd)), 0)', 'total')
			.where('l.sales_order_id = :orderId', { orderId })
			.andWhere('l.type = 2')
			.getRawOne();
		return parseFloat(result?.total || '0');
	}

	/** 获取上月结余（负数余额滚入下月） */
	private async getPreviousBalance(
		salespersonId: string,
		currentMonth: string,
	): Promise<number> {
		const prevMonth = this.getPrevMonth(currentMonth);
		const prev = await this.settlementRepo.findOne({
			where: { salespersonId, settleMonth: prevMonth },
		});
		if (prev && parseFloat(prev.netCommission) < 0) {
			return parseFloat(prev.netCommission);
		}
		return 0;
	}

	/** 获取上月结余 USD（负数余额滚入下月） */
	private async getPreviousBalanceUsd(
		salespersonId: string,
		currentMonth: string,
	): Promise<number> {
		const prevMonth = this.getPrevMonth(currentMonth);
		const prev = await this.settlementRepo.findOne({
			where: { salespersonId, settleMonth: prevMonth },
		});
		if (prev && prev.netCommissionUsd && parseFloat(prev.netCommissionUsd) < 0) {
			return parseFloat(prev.netCommissionUsd);
		}
		return 0;
	}

	/** 获取上一个月 */
	private getPrevMonth(month: string): string {
		const [year, mon] = month.split('-').map(Number);
		const prev = new Date(year, mon - 2, 1); // month is 1-indexed, so mon-2 gives prev month
		return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
	}
}
