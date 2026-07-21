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
	QuerySummaryDto,
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

		// 加载订单
		const orderRepo = manager
			? manager.getRepository(SalesOrder)
			: this.orderRepo;
		const order = await orderRepo.findOne({ where: { id: orderId } });
		if (!order || order.status !== 2 || !order.salespersonId) return null;

		// 幂等校验：该订单是否已有计提分录（取最早一条 = 原始计提，其 status 反映是否已结算）
		const existing = await ledgerRepo.findOne({
			where: { salesOrderId: orderId, type: 1 },
			order: { createdTime: 'ASC' },
		});
		if (existing) {
			// 重新完成场景（退货换货后补发再次完成）：重算利润，若变化则更新计提分录
			const profit = await this.calcOrderProfit(orderId, manager);
			const baseCny = Math.max(0, profit.salesProfitCny);
			const baseUsd = Math.max(0, profit.salesProfitUsd);
			const rate = parseFloat(existing.commissionRate || '0');
			const newCommissionCny = this.calcCommission(String(baseCny), rate);
			const newCommissionUsd = this.calcCommission(String(baseUsd), rate);

			if (existing.status === 2) {
					// 原计提分录已结算：不可原地修改（否则会篡改已结算月份的金额）
					// 始终比较「当前净提成 vs 应有净提成」，不依赖 profitChanged：
					// 冲回后利润可能恢复到恰好等于原始 profitBase，此时 profitChanged=false
					// 但净提成仍低于应有值（冲回未反转），必须生成差额补提分录
					const totalAccrualCny = await this.getTotalAccrualForOrder(orderId, manager);
					const totalAccrualUsd = await this.getTotalAccrualForOrderUsd(orderId, manager);
					const totalClawbackCny = await this.getTotalClawbackForOrder(orderId, manager);
					const totalClawbackUsd = await this.getTotalClawbackForOrderUsd(orderId, manager);

					// 当前净提成（订单全部 type=1 之和 - 全部 type=2 绝对值之和）vs 应有净提成
					const currentNetCny = totalAccrualCny - totalClawbackCny;
					const currentNetUsd = totalAccrualUsd - totalClawbackUsd;
					const deltaCny = parseFloat(newCommissionCny) - currentNetCny;
					const deltaUsd = parseFloat(newCommissionUsd) - currentNetUsd;

					// 差额极小（精度误差）时不生成差额分录
					if (Math.abs(deltaCny) >= 0.01 || Math.abs(deltaUsd) >= 0.01) {
						const isIncrease = deltaCny >= 0;
						const diffLedger = ledgerRepo.create({
							id: snowflake.nextId(),
							salespersonId: existing.salespersonId,
							salesOrderId: orderId,
							paymentId: null,
							type: isIncrease ? 1 : 2, // 提成增加→补提(type=1)，减少→冲回(type=2)
							status: 1, // 待结算，计入当期
							orderAmountUsd: order.totalAmountUsd,
							orderAmountCny: order.totalAmountCny,
							receivedAmountUsd: order.receivedAmountUsd,
							receivedAmountCny: order.receivedAmountCny,
							profitBaseUsd: baseUsd.toFixed(2),
							profitBaseCny: baseCny.toFixed(2),
							revenueAdjustmentUsd: '0',
							revenueAdjustmentCny: '0',
							commissionRate: existing.commissionRate,
							// 存储原始 delta（含正负号）；type 由 CNY 符号决定，金额保留各币种实际方向
							commissionAmountUsd: deltaUsd.toFixed(2),
							commissionAmountCny: deltaCny.toFixed(2),
							currency: order.currency || 'USD',
							exchangeRate: order.exchangeRate,
							remark: isIncrease
								? '重新完成差额补提（原分录已结算）'
								: '重新完成差额冲回（原分录已结算）',
						});
						await ledgerRepo.save(diffLedger);
						this.logger.log(
							`提成差额调整(原分录已结算): 订单 ${orderId}, ` +
							`${isIncrease ? '补提' : '冲回'} ${Math.abs(deltaCny).toFixed(2)} CNY, ` +
							`调整后净提成 ${newCommissionCny} CNY`,
						);
					}
				} else {
					// 原计提分录待结算：利润变化 或 NET 偏差（如 revoke 后重新完成）时原地更新
					const previousClawbackCny = await this.getTotalClawbackForOrder(orderId, manager);
					const previousClawbackUsd = await this.getTotalClawbackForOrderUsd(orderId, manager);
					const currentNetCny = parseFloat(existing.commissionAmountCny) - previousClawbackCny;
					const currentNetUsd = parseFloat(existing.commissionAmountUsd || '0') - previousClawbackUsd;

					const profitChanged =
						existing.profitBaseCny !== baseCny.toFixed(2) ||
						existing.profitBaseUsd !== baseUsd.toFixed(2);
					// P1: revoke 后利润可能未变但 NET 已归零，必须检测 NET 偏差
					const netDeviation =
						Math.abs(parseFloat(newCommissionCny) - currentNetCny) >= 0.01 ||
						Math.abs(parseFloat(newCommissionUsd) - currentNetUsd) >= 0.01;

					if (profitChanged || netDeviation) {
						// 加上已冲回金额，避免双重计算：
						// type=1 存储 (应有提成 + 已冲回)，使得 净提成 = type=1 - type=2 = 应有提成
						const adjustedCommissionCny = (parseFloat(newCommissionCny) + previousClawbackCny).toFixed(2);
						const adjustedCommissionUsd = (parseFloat(newCommissionUsd) + previousClawbackUsd).toFixed(2);

						existing.profitBaseCny = baseCny.toFixed(2);
						existing.profitBaseUsd = baseUsd.toFixed(2);
						existing.commissionAmountCny = adjustedCommissionCny;
						existing.commissionAmountUsd = adjustedCommissionUsd;
						existing.receivedAmountUsd = order.receivedAmountUsd;
						existing.receivedAmountCny = order.receivedAmountCny;
						await ledgerRepo.save(existing);
						this.logger.log(
							`提成重算(重新完成): 订单 ${orderId}, ` +
							`利润 ${baseCny.toFixed(2)} CNY, 净提成 ${newCommissionCny} CNY, ` +
							`含已冲回 ${previousClawbackCny.toFixed(2)} CNY`,
						);
					}
				}
			return existing;
		}

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
		// 零利润守卫：无利润时不创建无意义的零金额分录
		if (baseCny <= 0 && baseUsd <= 0) return null;
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
			profitBaseUsd: baseUsd.toFixed(2),
			profitBaseCny: baseCny.toFixed(2),
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
	 * 2. 计算当前利润（calcOrderProfit 已包含 refundedAmount 扣减）
	 * 3. 差额 = 原提成 - 当前应有提成 - 已冲回金额 → 生成本次冲回分录
	 *
	 * 支持多次退款/退货：每次基于当前实际利润计算，不会重复扣减
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

		// 1. 查找该订单的计提分录（不存在 = 订单未完成，无需冲回；取最早一条 = 原始计提）
		const accrualEntry = await ledgerRepo.findOne({
			where: { salesOrderId: orderId, type: 1 },
			order: { createdTime: 'ASC' },
		});
		if (!accrualEntry) return null;

		// 2. 累计收入调整（仅用于审计追踪，不参与利润计算）
		const currentAdjUsd = parseFloat(
			accrualEntry.revenueAdjustmentUsd || '0',
		);
		const currentAdjCny = parseFloat(
			accrualEntry.revenueAdjustmentCny || '0',
		);
		const newAdjUsd = currentAdjUsd + parseFloat(refundAmountUsd);
		const newAdjCny = currentAdjCny + parseFloat(refundAmountCny);

		// 3. 获取订单和当前利润（calcOrderProfit 已扣减 refundedAmount）
		const orderRepo = manager
			? manager.getRepository(SalesOrder)
			: this.orderRepo;
		const order = await orderRepo.findOne({ where: { id: orderId } });
		if (!order) return null;

		const profit = await this.calcOrderProfit(orderId, manager);

		// 4. 当前利润即为调整后利润（refundedAmount 已在 calcOrderProfit 中扣减）
		const adjustedProfitCny = profit.salesProfitCny;
		const adjustedProfitUsd = profit.salesProfitUsd;

		// 5. 计算应有提成 vs 已计提提成
		const rate = parseFloat(accrualEntry.commissionRate || '0');
		// 原始计提总额 = 该订单所有 type=1 分录之和（含重新完成差额补提分录）
		const originalCommissionCny = await this.getTotalAccrualForOrder(
			orderId,
			manager,
		);
		const originalCommissionUsd = await this.getTotalAccrualForOrderUsd(
			orderId,
			manager,
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

		// P2: 提成已被全额撤销（revoke 后 NET≤0）时不再重算，防止产生错误补提
		if (
			previousClawbackCny >= originalCommissionCny - 0.01 &&
			previousClawbackUsd >= originalCommissionUsd - 0.01
		) {
			return null;
		}

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

		// 7. 创建调整分录（正常冲回 type=2；利润反升时补提 type=1）
		const isClawback = clawbackCny >= 0;
		const ledger = ledgerRepo.create({
			id: snowflake.nextId(),
			salespersonId: accrualEntry.salespersonId,
			salesOrderId: orderId,
			paymentId: paymentId || null,
			salesReturnId: salesReturnId || null,
			type: isClawback ? 2 : 1, // 冲回 or 补提
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
			commissionAmountUsd: clawbackUsd >= 0
				? `-${clawbackUsd.toFixed(2)}`
				: Math.abs(clawbackUsd).toFixed(2),
			commissionAmountCny: clawbackCny >= 0
				? `-${clawbackCny.toFixed(2)}`
				: Math.abs(clawbackCny).toFixed(2),
			currency: order.currency || 'USD',
			exchangeRate: order.exchangeRate,
			remark: isClawback
				? (salesReturnId ? '退货重算冲回' : '退款重算冲回')
				: '退款后利润上升补提',
		});

		const saved = await ledgerRepo.save(ledger);

		// 8. 更新原计提分录的收入调整字段（审计追踪）
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
	 * M3: 订单重开时全额撤销提成（status 2→1 跃迁时调用）
	 * 换货退货使已完成订单重新打开时，提成应全额冲回；
	 * 待订单再次完成后 accrueOrderCommission 会重新计提正确金额。
	 * 若订单无计提记录或 NET 已为 0，则无操作。
	 */
	async revokeOrderCommission(
		orderId: string,
		externalManager?: EntityManager,
	): Promise<CommissionLedger | null> {
		const ledgerRepo = externalManager
			? externalManager.getRepository(CommissionLedger)
			: this.ledgerRepo;

		// 查找原计提分录
		const accrualEntry = await ledgerRepo.findOne({
			where: { salesOrderId: orderId, type: 1 },
		});
		if (!accrualEntry) return null; // 从未计提，无需撤销

		// 计算当前 NET（所有分录之和）
		const netResult = await ledgerRepo
			.createQueryBuilder('l')
			.select('COALESCE(SUM(l.commission_amount_cny), 0)', 'netCny')
			.addSelect('COALESCE(SUM(l.commission_amount_usd), 0)', 'netUsd')
			.where('l.sales_order_id = :orderId', { orderId })
			.getRawOne();
		const netCny = parseFloat(netResult?.netCny || '0');
		const netUsd = parseFloat(netResult?.netUsd || '0');

		if (Math.abs(netCny) < 0.01 && Math.abs(netUsd) < 0.01) {
			return null; // NET 已为 0，无需重复撤销
		}

		// 获取订单信息
		const orderRepo = externalManager
			? externalManager.getRepository(SalesOrder)
			: this.orderRepo;
		const order = await orderRepo.findOne({ where: { id: orderId } });
		if (!order) return null;

		// 创建全额冲回分录（type=2，金额 = -NET）
		const ledger = ledgerRepo.create({
			id: snowflake.nextId(),
			salespersonId: accrualEntry.salespersonId,
			salesOrderId: orderId,
			paymentId: null,
			salesReturnId: null,
			type: 2,
			status: 1,
			orderAmountUsd: order.totalAmountUsd,
			orderAmountCny: order.totalAmountCny,
			receivedAmountUsd: '0',
			receivedAmountCny: '0',
			profitBaseUsd: '0',
			profitBaseCny: '0',
			revenueAdjustmentUsd: '0',
			revenueAdjustmentCny: '0',
			commissionRate: accrualEntry.commissionRate,
			commissionAmountUsd: netUsd >= 0 ? `-${netUsd.toFixed(2)}` : Math.abs(netUsd).toFixed(2),
			commissionAmountCny: netCny >= 0 ? `-${netCny.toFixed(2)}` : Math.abs(netCny).toFixed(2),
			currency: order.currency || 'USD',
			exchangeRate: order.exchangeRate,
			remark: '订单重开全额撤销提成',
		});

		const saved = await ledgerRepo.save(ledger);
		this.logger.log(
			`提成全额撤销: 订单 ${orderId}, 冲回 ${netCny.toFixed(2)} CNY / ${netUsd.toFixed(2)} USD`,
		);
		return saved;
	}

	/**
	 * 月度结算 ⭐
	 * 汇总当月所有待结算分录，生成结算记录
	 *
	 * 月份归属设计说明：按 created_time 归属是正确的——
	 * created_time 即业务事件发生时间（计提=订单完成时刻，冲回=退款/退货时刻，
	 * 差额分录=重新完成时刻），分录计入事件实际发生的月份。
	 * 跨月退款产生的冲回记入退款当月（而非原计提月），符合收付实现制。
	 */
	async settleMonth(month: string): Promise<CommissionSettlement[]> {
		// 校验月份格式
		if (!/^\d{4}-\d{2}$/.test(month)) {
			throw new BadRequestException('月份格式错误，应为 YYYY-MM');
		}

		// 前置校验1：不能结算当月或未来月份（当月分录可能仍在产生）
		const now = new Date();
		const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		if (month >= currentMonth) {
			throw new BadRequestException('当月尚未结束，不能结算');
		}

		// 前置校验2：前序月份必须已结算（防止跳月导致负数结余滚入错位）
		// YYYY-MM 字符串比较天然支持跨年（'2026-12' < '2027-01'）
		const unsettled = await this.dataSource.query(
			`SELECT DISTINCT DATE_FORMAT(l.created_time, '%Y-%m') AS m
			 FROM commission_ledger l
			 WHERE DATE_FORMAT(l.created_time, '%Y-%m') < ?
			   AND NOT EXISTS (
			     SELECT 1 FROM commission_settlement s
			     WHERE s.settle_month = DATE_FORMAT(l.created_time, '%Y-%m')
			   )
			 ORDER BY m
			 LIMIT 1`,
			[month],
		);
		if (unsettled.length > 0) {
			const [year, mon] = (unsettled[0].m as string).split('-');
			throw new BadRequestException(
				`${year}年${mon}月还未结算，请先结算前面月份`,
			);
		}

		return this.dataSource.transaction(async (manager: EntityManager) => {
			const settlementRepo = manager.getRepository(CommissionSettlement);

			// 幂等守卫：该月已有结算记录则拒绝重复操作
			const existingCount = await settlementRepo.count({
				where: { settleMonth: month },
			});
			if (existingCount > 0) {
				throw new BadRequestException(`${month} 已结算，请勿重复操作`);
			}

			const results: CommissionSettlement[] = [];

			// 查询所有有当月待结算分录的销售员
			const salespersons = await manager.query(
				`SELECT DISTINCT salesperson_id FROM commission_ledger 
				 WHERE status = 1 AND DATE_FORMAT(created_time, '%Y-%m') = ?`,
				[month],
			);

			for (const { salesperson_id } of salespersons) {
				// 计提总额（type=1）— FOR UPDATE 锁定分录行，防止并发插入被 UPDATE 标记但未被 SUM 统计
				const earnedResult = await manager.query(
					`SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
					        COALESCE(SUM(commission_amount_usd), 0) AS totalUsd,
					        COUNT(DISTINCT sales_order_id) AS order_count
					 FROM commission_ledger
					 WHERE salesperson_id = ? AND status = 1 AND type = 1
					   AND DATE_FORMAT(created_time, '%Y-%m') = ?
					 FOR UPDATE`,
					[salesperson_id, month],
				);

				// 冲回总额（type=2，-SUM 取反得正数冲回额；与 getTotalClawbackForOrder 一致）
				const clawbackResult = await manager.query(
					`SELECT COALESCE(-SUM(commission_amount_cny), 0) AS total,
					        COALESCE(-SUM(commission_amount_usd), 0) AS totalUsd,
					        COUNT(*) AS clawback_count
					 FROM commission_ledger
					 WHERE salesperson_id = ? AND status = 1 AND type = 2
					   AND DATE_FORMAT(created_time, '%Y-%m') = ?
					 FOR UPDATE`,
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

				// 上月结余（负数余额）— 读取已提交的历史结算，无需事务内
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
				const settlement = settlementRepo.create({
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
				await settlementRepo.save(settlement);

				// 标记分录为已结算
				await manager.query(
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
		});
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
	 * 支持与提成分录列表相同的筛选条件（销售员/类型/状态/结算月份/日期范围），
	 * 所有条件统一应用到 计提/冲回/待结算 三条聚合查询，保证统计与列表同口径。
	 */
	async getSummary(query: QuerySummaryDto) {
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (query.salespersonId) {
			conditions.push('salesperson_id = ?');
			params.push(query.salespersonId);
		}
		if (query.type !== undefined) {
			conditions.push('type = ?');
			params.push(query.type);
		}
		if (query.status !== undefined) {
			conditions.push('status = ?');
			params.push(query.status);
		}
		if (query.settleMonth) {
			conditions.push('settle_month = ?');
			params.push(query.settleMonth);
		}
		if (query.startDate) {
			conditions.push('created_time >= ?');
			params.push(query.startDate);
		}
		if (query.endDate) {
			conditions.push('created_time <= ?');
			params.push(query.endDate);
		}

		const where = conditions.length
			? `AND ${conditions.join(' AND ')}`
			: '';

		// 计提总额（type=1）
		const earned = await this.dataSource.query(
			`SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
			        COALESCE(SUM(commission_amount_usd), 0) AS totalUsd
			 FROM commission_ledger WHERE type = 1 ${where}`,
			params,
		);

		// 冲回总额（H2: 用 -SUM 替代 SUM(ABS)，与核心账本逻辑一致）
		const clawback = await this.dataSource.query(
			`SELECT COALESCE(-SUM(commission_amount_cny), 0) AS total,
			        COALESCE(-SUM(commission_amount_usd), 0) AS totalUsd
			 FROM commission_ledger WHERE type = 2 ${where}`,
			params,
		);

		// 待结算总额（status=1，同样遵循筛选条件）
		const pending = await this.dataSource.query(
			`SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
			        COALESCE(SUM(commission_amount_usd), 0) AS totalUsd
			 FROM commission_ledger WHERE status = 1 ${where}`,
			params,
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
				COALESCE(SUM(CASE WHEN l.type = 2 THEN -l.commission_amount_cny ELSE 0 END), 0) AS totalClawback,
				COALESCE(SUM(CASE WHEN l.type = 2 THEN -l.commission_amount_usd ELSE 0 END), 0) AS totalClawbackUsd,
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
	 * 公式：销售利润 = 订单金额 - 博主佣金 - 已退款 - 直接退款 - 产品成本(FIFO) - 额外成本
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

		// 博主佣金（与 getProfitSummary 一致：totalAmount × rate / 100）
		const totalAmountCny = parseFloat(order.totalAmountCny || '0');
		const bloggerRate = parseFloat(order.bloggerCommissionRate || '0');
		const bloggerCommissionCny = totalAmountCny * bloggerRate / 100;
		const bloggerCommissionUsd = exchangeRate > 0 ? bloggerCommissionCny / exchangeRate : 0;

		// 已退款金额（退货退款/仅退款产生的退款，减少有效收入）
		const refundedAmountCny = parseFloat(order.refundedAmountCny || '0');
		const refundedAmountUsd = exchangeRate > 0 ? refundedAmountCny / exchangeRate : 0;

		// 直接退款金额（不经过退货流程的直接退款，减少有效收入）
		const standaloneRefundedAmountCny = parseFloat(order.standaloneRefundedAmountCny || '0');
		const standaloneRefundedAmountUsd = exchangeRate > 0 ? standaloneRefundedAmountCny / exchangeRate : 0;

		// H2: USD 统一由 CNY / 汇率派生，与 getProfitSummary 保持一致，
		// 消除入库时 unitCostCny 舍入累积导致的 USD 独立计算偏差
		const totalAmountUsd = exchangeRate > 0 ? totalAmountCny / exchangeRate : 0;
		const productCostUsdDerived = exchangeRate > 0 ? productCostCny / exchangeRate : 0;
		const extraCostUsdDerived = exchangeRate > 0 ? extraCostCny / exchangeRate : 0;

		// 销售利润 = 订单金额 - 博主佣金 - 已退款 - 直接退款 - 产品成本 - 额外成本
		const salesProfitCny = totalAmountCny - bloggerCommissionCny
			- refundedAmountCny - standaloneRefundedAmountCny - productCostCny - extraCostCny;
		const salesProfitUsd = exchangeRate > 0 ? salesProfitCny / exchangeRate : 0;

		return {
			totalAmountCny,
			totalAmountUsd,
			productCostCny,
			productCostUsd: productCostUsdDerived,
			extraCostCny,
			extraCostUsd: extraCostUsdDerived,
			bloggerCommissionCny,
			bloggerCommissionUsd,
			salesProfitCny,
			salesProfitUsd,
			exchangeRate,
		};
	}

	/** 查询订单已有冲回总额（CNY）
	 * 使用 -SUM(amount) 而非 SUM(ABS(amount))：
	 * type=2 正常冲回存储负值 → -SUM(负) = 正（冲回额）；
	 * 极端汇率下 type=2 可能存正值 → -SUM(正) = 负（反向调整），保证 NET 不变量。
	 */
	private async getTotalClawbackForOrder(
		orderId: string,
		manager?: EntityManager,
	): Promise<number> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;
		const result = await ledgerRepo
			.createQueryBuilder('l')
			.select('COALESCE(-SUM(l.commission_amount_cny), 0)', 'total')
			.where('l.sales_order_id = :orderId', { orderId })
			.andWhere('l.type = 2')
			.getRawOne();
		return parseFloat(result?.total || '0');
	}

	/** 查询订单已有冲回总额（USD，逻辑同 CNY 版本） */
	private async getTotalClawbackForOrderUsd(
		orderId: string,
		manager?: EntityManager,
	): Promise<number> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;
		const result = await ledgerRepo
			.createQueryBuilder('l')
			.select('COALESCE(-SUM(l.commission_amount_usd), 0)', 'total')
			.where('l.sales_order_id = :orderId', { orderId })
			.andWhere('l.type = 2')
			.getRawOne();
		return parseFloat(result?.total || '0');
	}

	/** 查询订单计提总额（CNY，所有 type=1 分录之和） */
	private async getTotalAccrualForOrder(
		orderId: string,
		manager?: EntityManager,
	): Promise<number> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;
		const result = await ledgerRepo
			.createQueryBuilder('l')
			.select('COALESCE(SUM(l.commission_amount_cny), 0)', 'total')
			.where('l.sales_order_id = :orderId', { orderId })
			.andWhere('l.type = 1')
			.getRawOne();
		return parseFloat(result?.total || '0');
	}

	/** 查询订单计提总额（USD，所有 type=1 分录之和） */
	private async getTotalAccrualForOrderUsd(
		orderId: string,
		manager?: EntityManager,
	): Promise<number> {
		const ledgerRepo = manager
			? manager.getRepository(CommissionLedger)
			: this.ledgerRepo;
		const result = await ledgerRepo
			.createQueryBuilder('l')
			.select('COALESCE(SUM(l.commission_amount_usd), 0)', 'total')
			.where('l.sales_order_id = :orderId', { orderId })
			.andWhere('l.type = 1')
			.getRawOne();
		return parseFloat(result?.total || '0');
	}

	/** 获取上月结余（负数余额滚入下月） */
	// L3: 查找 currentMonth 之前最近一条结算记录（支持跳月）
	private async getPreviousBalance(
		salespersonId: string,
		currentMonth: string,
	): Promise<number> {
		const prev = await this.settlementRepo
			.createQueryBuilder('s')
			.where('s.salesperson_id = :salespersonId', { salespersonId })
			.andWhere('s.settle_month < :currentMonth', { currentMonth })
			.orderBy('s.settle_month', 'DESC')
			.getOne();
		if (prev && parseFloat(prev.netCommission) < 0) {
			return parseFloat(prev.netCommission);
		}
		return 0;
	}

	/** 获取上月结余 USD（负数余额滚入下月） */
	// L3: 查找 currentMonth 之前最近一条结算记录（支持跳月）
	private async getPreviousBalanceUsd(
		salespersonId: string,
		currentMonth: string,
	): Promise<number> {
		const prev = await this.settlementRepo
			.createQueryBuilder('s')
			.where('s.salesperson_id = :salespersonId', { salespersonId })
			.andWhere('s.settle_month < :currentMonth', { currentMonth })
			.orderBy('s.settle_month', 'DESC')
			.getOne();
		if (prev && prev.netCommissionUsd && parseFloat(prev.netCommissionUsd) < 0) {
			return parseFloat(prev.netCommissionUsd);
		}
		return 0;
	}
}
