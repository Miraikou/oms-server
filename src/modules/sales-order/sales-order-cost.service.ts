import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesOrderCost } from './entities/sales-order-cost.entity';
import { RateService } from '@/common/rate/rate.service';
import { snowflake } from '@/common/utils/snowflake';
import { computeDualAmounts } from '@/common/utils/dual-currency';
import type {
	CreateSalesOrderCostDto,
	UpdateSalesOrderCostDto,
} from './dto/sales-order.dto';

/**
 * 订单成本服务
 * 管理订单的额外成本（物流、广告、平台手续费等）
 * 支持多币种，汇率由后端自动查询
 * 唯一约束：orderId + costTypeId
 */
@Injectable()
export class SalesOrderCostService {
	private readonly logger = new Logger(SalesOrderCostService.name);

	constructor(
		@InjectRepository(SalesOrderCost)
		private readonly costRepo: Repository<SalesOrderCost>,
		private readonly rateService: RateService,
	) {}

	/**
	 * 获取订单的所有成本
	 */
	async findByOrderId(orderId: string): Promise<SalesOrderCost[]> {
		return this.costRepo.find({ where: { orderId } });
	}

	/**
	 * 获取单条成本详情
	 */
	async findOne(id: string): Promise<SalesOrderCost> {
		const cost = await this.costRepo.findOne({ where: { id } });
		if (!cost) throw new BadRequestException('成本记录不存在');
		return cost;
	}

	/**
	 * 添加订单成本
	 * 同一订单同一成本类型不能重复
	 * 后端自动查询汇率（不信任前端）
	 */
	async create(
		orderId: string,
		dto: CreateSalesOrderCostDto,
	): Promise<SalesOrderCost> {
		// 检查唯一性
		const existing = await this.costRepo.findOne({
			where: { orderId, costTypeId: dto.costTypeId },
		});
		if (existing) {
			throw new BadRequestException('该成本类型已存在，请直接修改金额');
		}

		const currency = dto.currency || 'CNY';
		const exchangeRate = await this.rateService.getRate(
			new Date().toISOString().slice(0, 10),
			'USD',
		);

		const dual = computeDualAmounts(dto.amount, currency, exchangeRate);

		const cost = this.costRepo.create({
			id: snowflake.nextId(),
			orderId,
			costTypeId: dto.costTypeId,
			amountUsd: dual.amountUsd,
			amountCny: dual.amountCny,
			currency,
			exchangeRate,
			remark: dto.remark || null,
		});

		return this.costRepo.save(cost);
	}

	/**
	 * 修改成本
	 * 如果币种变更，重新查询汇率；否则保留原汇率
	 */
	async update(
		id: string,
		dto: UpdateSalesOrderCostDto,
	): Promise<SalesOrderCost> {
		const cost = await this.costRepo.findOne({ where: { id } });
		if (!cost) throw new BadRequestException('成本记录不存在');

		// 保存原始金额（在原币种下的值），用于只改币种时正确重算
		const originalAmount = cost.currency === 'CNY' ? cost.amountCny : cost.amountUsd;

		// 成本类型变更 → 校验唯一约束
		if (dto.costTypeId !== undefined && dto.costTypeId !== cost.costTypeId) {
			const conflict = await this.costRepo.findOne({
				where: { orderId: cost.orderId, costTypeId: dto.costTypeId },
			});
			if (conflict) {
				throw new BadRequestException('该订单下已存在相同成本类型');
			}
			cost.costTypeId = dto.costTypeId;
		}

		if (dto.amount !== undefined) {
			cost.amountUsd = dto.amount; // temporary, will be recomputed below
		}

		// 币种变更 → 重新查汇率
		if (dto.currency !== undefined && dto.currency !== cost.currency) {
			cost.currency = dto.currency || 'CNY';
			cost.exchangeRate = await this.rateService.getRate(
				new Date().toISOString().slice(0, 10),
				'USD',
			);
		}

		// 金额或汇率变化时重算 amountUsd 和 amountCny
		if (dto.amount !== undefined || dto.currency !== undefined) {
			const dual = computeDualAmounts(
				dto.amount !== undefined ? dto.amount : originalAmount,
				cost.currency,
				cost.exchangeRate,
			);
			cost.amountUsd = dual.amountUsd;
			cost.amountCny = dual.amountCny;
		}

		if (dto.remark !== undefined) {
			cost.remark = dto.remark === '' ? null : dto.remark;
		}

		return this.costRepo.save(cost);
	}

	/**
	 * 删除成本记录
	 */
	async remove(id: string): Promise<void> {
		const cost = await this.costRepo.findOne({ where: { id } });
		if (!cost) throw new BadRequestException('成本记录不存在');
		await this.costRepo.remove(cost);
	}
}
