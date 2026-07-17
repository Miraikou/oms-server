import {
	Controller,
	Get,
	Post,
	Put,
	Body,
	Query,
	Param,
	UseGuards,
} from '@nestjs/common';
import { CommissionService } from './commission.service';
import {
	SettleMonthDto,
	QueryLedgerDto,
	QuerySettlementDto,
	ConfirmSettlementDto,
} from './dto/commission.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

/**
 * 提成管理接口 ⭐
 */
@Controller('commission')
@UseGuards(JwtAuthGuard)
export class CommissionController {
	constructor(private readonly commissionService: CommissionService) {}

	/**
	 * 触发月度结算
	 * POST /api/commission/settle
	 */
	@Post('settle')
	async settleMonth(@Body() dto: SettleMonthDto) {
		const results = await this.commissionService.settleMonth(dto.month);
		return { message: '结算完成', data: results };
	}

	/**
	 * 确认发放
	 * PUT /api/commission/settlement/:id/confirm
	 */
	@Put('settlement/:id/confirm')
	async confirmSettlement(
		@Param('id') id: string,
		@Body() dto: ConfirmSettlementDto,
	) {
		return this.commissionService.confirmSettlement(id, dto.paidAmount);
	}

	/**
	 * 查询提成分录
	 * GET /api/commission/ledger
	 */
	@Get('ledger')
	async findLedger(@Query() query: QueryLedgerDto) {
		return this.commissionService.findLedger(query);
	}

	/**
	 * 查询结算记录
	 * GET /api/commission/settlement
	 */
	@Get('settlement')
	async findSettlement(@Query() query: QuerySettlementDto) {
		return this.commissionService.findSettlement(query);
	}

	/**
	 * 提成汇总统计
	 * GET /api/commission/summary
	 */
	@Get('summary')
	async getSummary(
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		return this.commissionService.getSummary(startDate, endDate);
	}

	/**
	 * 按销售员汇总
	 * GET /api/commission/salesperson-summary
	 */
	@Get('salesperson-summary')
	async getSalespersonSummary(
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
	) {
		return this.commissionService.getSalespersonSummary(
			startDate,
			endDate,
		);
	}
}
