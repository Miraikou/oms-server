import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { CommissionLedger } from './entities/commission-ledger.entity';
import { CommissionSettlement } from './entities/commission-settlement.entity';
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity';
import { snowflake } from '@/common/utils/snowflake';
import type {
	QueryLedgerDto,
	QuerySettlementDto,
} from './dto/commission.dto';

/**
 * 提成服务 ⭐
 * 核心方法：recordCommission（收款计提）、recordClawback（退款冲回）、settleMonth（月度结算）
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
		private readonly dataSource: DataSource,
	) {}

	/**
	 * 收款时计提提成 ⭐
	 * 在 payment.service.ts create() 中调用
	 */
	async recordCommission(
		params: {
			salesOrderId: string;
			paymentId: string;
			salespersonId: string;
			orderAmountUsd: string;
			orderAmountCny: string;
			receivedAmountUsd: string;
			receivedAmountCny: string;
			currency: string;
			exchangeRate: string;
		},
		manager?: EntityManager,
	): Promise<CommissionLedger | null> {
		const repo = manager
			? manager.getRepository(Salesperson)
			: this.salespersonRepo;
		const salesperson = await repo.findOne({
			where: { id: params.salespersonId },
		});

		// 销售员不存在或已停用，不生成提成
		if (!salesperson || salesperson.status !== 1) {
			return null;
		}

		const rate = parseFloat(salesperson.commissionRate || '0');
		if (rate <= 0) return null;

		const commissionAmountUsd = this.calcCommission(
			params.receivedAmountUsd,
			rate,
		);
		const commissionAmountCny = this.calcCommission(
			params.receivedAmountCny,
			rate,
		);

		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;

		const ledger = ledgerRepo.create({
			id: snowflake.nextId(),
			salespersonId: params.salespersonId,
			salesOrderId: params.salesOrderId,
			paymentId: params.paymentId,
			type: 1, // 计提
			status: 1, // 待结算
			orderAmountUsd: params.orderAmountUsd,
			orderAmountCny: params.orderAmountCny,
			receivedAmountUsd: params.receivedAmountUsd,
			receivedAmountCny: params.receivedAmountCny,
			commissionRate: salesperson.commissionRate,
			commissionAmountUsd,
			commissionAmountCny,
			currency: params.currency,
			exchangeRate: params.exchangeRate,
			remark: '收款计提',
		});

		const saved = await ledgerRepo.save(ledger);
		this.logger.log(
			`提成计提: 销售员 ${salesperson.name}, 订单 ${params.salesOrderId}, ${commissionAmountCny} CNY`,
		);
		return saved;
	}

	/**
	 * 退款时冲回提成 ⭐
	 * 在 sales-return.service.ts create() 中调用
	 */
	async recordClawback(
		params: {
			salesOrderId: string;
			paymentId: string;
			salesReturnId: string;
			salespersonId: string;
			orderAmountUsd: string;
			orderAmountCny: string;
			refundAmountUsd: string;
			refundAmountCny: string;
			currency: string;
			exchangeRate: string;
		},
		manager?: EntityManager,
	): Promise<CommissionLedger | null> {
		const repo = manager
			? manager.getRepository(Salesperson)
			: this.salespersonRepo;
		const salesperson = await repo.findOne({
			where: { id: params.salespersonId },
		});

		// 销售员不存在也生成冲回记录（用默认比例 40%）
		const rate = salesperson
			? parseFloat(salesperson.commissionRate || '0')
			: 40;
		const commissionRateStr = salesperson
			? salesperson.commissionRate
			: '40.0000';

		if (rate <= 0) return null;

		const commissionAmountUsd = this.calcCommission(
			params.refundAmountUsd,
			rate,
		);
		const commissionAmountCny = this.calcCommission(
			params.refundAmountCny,
			rate,
		);

		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;

		const ledger = ledgerRepo.create({
			id: snowflake.nextId(),
			salespersonId: params.salespersonId,
			salesOrderId: params.salesOrderId,
			paymentId: params.paymentId,
			salesReturnId: params.salesReturnId,
			type: 2, // 冲回
			status: 1, // 待结算
			orderAmountUsd: params.orderAmountUsd,
			orderAmountCny: params.orderAmountCny,
			receivedAmountUsd: `-${params.refundAmountUsd}`,
			receivedAmountCny: `-${params.refundAmountCny}`,
			commissionRate: commissionRateStr,
			commissionAmountUsd: `-${commissionAmountUsd}`,
			commissionAmountCny: `-${commissionAmountCny}`,
			currency: params.currency,
			exchangeRate: params.exchangeRate,
			remark: '退款冲回',
		});

		const saved = await ledgerRepo.save(ledger);
		this.logger.log(
			`提成冲回: 销售员 ${params.salespersonId}, 订单 ${params.salesOrderId}, -${commissionAmountCny} CNY`,
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

	// ==================== 私有方法 ====================

	/** 计算提成金额 */
	private calcCommission(baseAmount: string, rate: number): string {
		const amount = parseFloat(baseAmount);
		return ((amount * rate) / 100).toFixed(2);
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
