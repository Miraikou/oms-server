import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 月度结算请求
 */
export class SettleMonthDto {
	@IsString()
	month: string; // YYYY-MM
}

/**
 * 提成分录查询
 */
export class QueryLedgerDto {
	@IsOptional()
	@IsString()
	salespersonId?: string;

	@IsOptional()
	@IsString()
	salesOrderId?: string;

	@IsOptional()
	@IsString()
	orderNo?: string;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	type?: number; // 1=计提 2=冲回

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	status?: number; // 1=待结算 2=已结算

	@IsOptional()
	@IsString()
	settleMonth?: string; // YYYY-MM

	@IsOptional()
	@IsString()
	startDate?: string;

	@IsOptional()
	@IsString()
	endDate?: string;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	page?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	pageSize?: number;
}

/**
 * 结算记录查询
 */
export class QuerySettlementDto {
	@IsOptional()
	@IsString()
	salespersonId?: string;

	@IsOptional()
	@IsString()
	settleMonth?: string;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	status?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	page?: number;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	pageSize?: number;
}

/**
 * 提成汇总统计查询
 * 与提成分录列表使用相同的筛选口径（不含分页）
 */
export class QuerySummaryDto {
	@IsOptional()
	@IsString()
	salespersonId?: string;

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	type?: number; // 1=计提 2=冲回

	@IsOptional()
	@IsNumber()
	@Type(() => Number)
	status?: number; // 1=待结算 2=已结算

	@IsOptional()
	@IsString()
	settleMonth?: string; // YYYY-MM

	@IsOptional()
	@IsString()
	startDate?: string;

	@IsOptional()
	@IsString()
	endDate?: string;
}

/**
 * 确认发放
 */
export class ConfirmSettlementDto {
	@IsString()
	paidAmount: string; // 实际发放金额
}
