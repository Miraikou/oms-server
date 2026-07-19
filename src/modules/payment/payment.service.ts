import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { SalesOrderService } from '@/modules/sales-order/sales-order.service';
import { snowflake } from '@/common/utils/snowflake';
import { computeDualAmounts } from '@/common/utils/dual-currency';
import type {
	CreatePaymentDto,
	CreateRefundDto,
	QueryPaymentDto,
} from './dto/payment.dto';
import { RateService } from '@/common/rate/rate.service';
import { CommissionService } from '@/modules/commission/commission.service';

/** 金额转为微元整数避免浮点精度问题（USD 精度 6 位 → ×1,000,000） */
const toMicroUnits = (s: string): number =>
	Math.round(parseFloat(s) * 1_000_000);

/**
 * 收款服务
 * 负责收款登记、超额校验、订单已收金额更新
 * 收款提交后禁止修改删除
 */
@Injectable()
export class PaymentService {
	private readonly logger = new Logger(PaymentService.name);

	constructor(
		@InjectRepository(Payment)
		private readonly paymentRepo: Repository<Payment>,
		@InjectRepository(SalesOrder)
		private readonly orderRepo: Repository<SalesOrder>,
		private readonly sequenceService: SequenceService,
		private readonly salesOrderService: SalesOrderService,
		private readonly dataSource: DataSource,
    private readonly rateService: RateService,
		private readonly commissionService: CommissionService,
	) {}

	/**
	 * 创建收款记录
	 * 事务：校验订单 → 校验不超额 → 生成收款单号 → 创建 Payment → 更新订单已收金额
	 */
	async create(dto: CreatePaymentDto): Promise<Payment> {
		const amountMicro = toMicroUnits(dto.amount);
		if (amountMicro <= 0) throw new BadRequestException('收款金额必须大于零');

		return this.dataSource.transaction(async (manager: EntityManager) => {
			const orderRepo = manager.getRepository(SalesOrder);
			const paymentRepo = manager.getRepository(Payment);

			// 1. 校验订单
			const order = await orderRepo.findOne({
				where: { id: dto.orderId },
			});
			if (!order) throw new BadRequestException('订单不存在');
			if (order.status !== 1) {
				throw new BadRequestException('订单已结束，无法收款');
			}

			// 2. 校验不超额（同币种直接比较）
			const currency = order.currency || 'USD';
			const totalOrder = currency === 'CNY' ? order.totalAmountCny : order.totalAmountUsd;
			const receivedOrder = currency === 'CNY' ? order.receivedAmountCny : order.receivedAmountUsd;
			const totalMicro = toMicroUnits(totalOrder);
			const receivedMicro = toMicroUnits(receivedOrder);
			if (receivedMicro + amountMicro > totalMicro) {
				throw new BadRequestException(
					`收款金额超出订单金额：订单 ${totalOrder}，已收 ${receivedOrder}，本次 ${dto.amount}`,
				);
			}

			// 3. 生成收款单号
			const paymentNo = await this.sequenceService.generate('SK');

			const exchangeRate = await this.rateService.getRate(
				dto.paymentDate,
				'USD',
			);
			const dualAmounts = computeDualAmounts(dto.amount, currency, exchangeRate);

			// 4. 创建 Payment 记录
			const payment = paymentRepo.create({
				id: snowflake.nextId(),
				paymentNo,
				type: 1,
				orderId: dto.orderId,
				paymentDate: new Date(dto.paymentDate),
				amountUsd: dualAmounts.amountUsd,
				currency,
				exchangeRate,
				amountCny: dualAmounts.amountCny,
				paymentMethod: dto.paymentMethod || null,
				payer: dto.payer || null,
				remark: dto.remark || null,
			});
			const savedPayment = await paymentRepo.save(payment);

			// 5. 更新订单已收金额 + 重算三维状态（使用付款记录的 USD/CNY 金额，保证汇率一致）
			await this.salesOrderService.updateReceivedAmount(
				dto.orderId,
				dualAmounts.amountUsd,
				dualAmounts.amountCny,
				manager,
			);

			// 6. 如果收款后订单变为已完成，触发提成计提（仅完成时计提一次）
			const updatedOrder = await orderRepo.findOne({ where: { id: order.id } });
			if (updatedOrder && updatedOrder.status === 2 && updatedOrder.salespersonId) {
				await this.commissionService.accrueOrderCommission(
					order.id,
					manager,
				);
			}

			this.logger.log(
				`收款成功: ${paymentNo}, 订单: ${order.orderNo}, ${dto.amount} ${currency}`,
			);
			return savedPayment;
		});
	}

	/**
	 * 创建退款记录
	 * 事务：校验订单 → 校验可退金额 → 生成退款单号 → 创建 Payment(type=2) → 扣减订单已收金额
	 */
	async createRefund(dto: CreateRefundDto): Promise<Payment> {
		const amountMicro = toMicroUnits(dto.amount);
		if (amountMicro <= 0) throw new BadRequestException('退款金额必须大于零');

		return this.dataSource.transaction(async (manager: EntityManager) => {
			const orderRepo = manager.getRepository(SalesOrder);
			const paymentRepo = manager.getRepository(Payment);

			// 1. 校验订单
			const order = await orderRepo.findOne({
				where: { id: dto.orderId },
			});
			if (!order) throw new BadRequestException('订单不存在');

			// 2. 校验可退金额（同币种直接比较）
			const currency = order.currency || 'USD';
			const receivedOrder = currency === 'CNY' ? order.receivedAmountCny : order.receivedAmountUsd;
			const receivedMicro = toMicroUnits(receivedOrder);
			if (receivedMicro <= 0) {
				throw new BadRequestException('该订单无已收款，无法退款');
			}
			if (amountMicro > receivedMicro) {
				throw new BadRequestException(
					`退款金额超出已收金额：已收 ${receivedOrder}，本次退 ${dto.amount}`,
				);
			}

			// 3. 生成退款单号（复用 SK 前缀）
			const paymentNo = await this.sequenceService.generate('TK');

			const exchangeRate = await this.rateService.getRate(
				dto.paymentDate,
				'USD',
			);
			const dualAmounts = computeDualAmounts(dto.amount, currency, exchangeRate);

			// 4. 创建退款记录
			const payment = paymentRepo.create({
				id: snowflake.nextId(),
				paymentNo,
				type: 2,
				orderId: dto.orderId,
				paymentDate: new Date(dto.paymentDate),
				amountUsd: dualAmounts.amountUsd,
				currency,
				exchangeRate,
				amountCny: dualAmounts.amountCny,
				paymentMethod: dto.paymentMethod || null,
				payer: dto.payer || null,
				remark: dto.remark || null,
			});
			const savedPayment = await paymentRepo.save(payment);

			// 5. 扣减订单已收金额 + 重算三维状态（使用退款记录的 USD/CNY 金额，保证汇率一致）
			await this.salesOrderService.decreaseReceivedAmount(
				dto.orderId,
				dualAmounts.amountUsd,
				dualAmounts.amountCny,
				manager,
			);

			// 6. 退款后重算提成差额（如果订单已计提提成）
			if (order.salespersonId) {
				await this.commissionService.recalculateOrderCommission(
					order.id,
					dualAmounts.amountUsd,
					dualAmounts.amountCny,
					savedPayment.id,
					'', // 非退货场景，无 salesReturnId
					manager,
				);
			}

			this.logger.log(
				`退款成功: ${paymentNo}, 订单: ${order.orderNo}, ${dto.amount} ${currency}`,
			);
			return savedPayment;
		});
	}

	/**
	 * 查询收款详情
	 */
	async findOne(id: string): Promise<Payment> {
		const payment = await this.paymentRepo.findOne({ where: { id } });
		if (!payment) throw new BadRequestException('收款记录不存在');
		return payment;
	}

	/**
	 * 分页查询收款列表
	 */
	async findAll(query: QueryPaymentDto) {
		const page = query.page || 1;
		const pageSize = query.pageSize || 20;
		const sortField = query.sortField || 'createdTime';
		const sortOrder = query.sortOrder || 'DESC';

		const qb = this.paymentRepo.createQueryBuilder('p');

		if (query.paymentNo) {
			qb.andWhere('p.paymentNo LIKE :no', { no: `%${query.paymentNo}%` });
		}
		if (query.orderId) {
			qb.andWhere('p.orderId = :orderId', { orderId: query.orderId });
		}
		if (query.type !== undefined) {
			qb.andWhere('p.type = :type', { type: query.type });
		}
		if (query.startDate) {
			qb.andWhere('p.paymentDate >= :startDate', {
				startDate: query.startDate,
			});
		}
		if (query.endDate) {
			qb.andWhere('p.paymentDate <= :endDate', {
				endDate: query.endDate,
			});
		}

		const allowedSortFields = ['createdTime', 'paymentDate', 'amountUsd', 'paymentNo'];
		if (!allowedSortFields.includes(sortField)) {
			throw new BadRequestException(`不支持的排序字段: ${sortField}`);
		}

		qb.orderBy(`p.${sortField}`, sortOrder)
			.skip((page - 1) * pageSize)
			.take(pageSize);

		const [list, total] = await qb.getManyAndCount();
		return { list, total, page, pageSize };
	}
}
