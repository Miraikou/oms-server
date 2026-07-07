import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RateService } from '@/common/rate/rate.service';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('查询汇率')
@UseGuards(JwtAuthGuard)
@Controller('rate')
export class RateController {
	constructor(private readonly rateService: RateService) {}

	@Get()
	@ApiOperation({ summary: '查询指定日期汇率' })
	async getRate(
		@Query('date') date: string,
		@Query('base') base: string,
		@Query('quotes') quotes: string = 'CNY',
	) {
		return await this.rateService.getRate({ date, base, quotes });
	}
}
