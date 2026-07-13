import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { ExchangeRateService } from './exchange-rate.service';
import { RateService } from '@/common/rate/rate.service';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  CreateExchangeRateDto,
  UpdateExchangeRateDto,
  QueryExchangeRateDto,
  SyncExchangeRateDto,
} from './dto/exchange-rate.dto';

@ApiTags('汇率管理')
@UseGuards(JwtAuthGuard)
@Controller('exchange-rates')
export class RateController {
  constructor(
    private readonly exchangeRateService: ExchangeRateService,
    private readonly rateService: RateService,
  ) {}

  @Get()
  @ApiOperation({ summary: '分页查询汇率列表' })
  async findAll(@Query() query: QueryExchangeRateDto) {
    return this.exchangeRateService.findAll(query);
  }

  @Get('query')
  @ApiOperation({ summary: '查询指定日期汇率' })
  async getRate(
    @Query('date') date: string,
    @Query('fromCurrency') fromCurrency: string,
    @Query('toCurrency') toCurrency: string = 'CNY',
  ) {
    const rate = await this.rateService.getRate(date, fromCurrency, toCurrency);
    return { fromCurrency, toCurrency, effectiveDate: date, rate };
  }

  @Post()
  @ApiOperation({ summary: '创建汇率记录' })
  async create(@Body() dto: CreateExchangeRateDto) {
    return this.exchangeRateService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新汇率记录' })
  async update(@Param('id') id: string, @Body() dto: UpdateExchangeRateDto) {
    return this.exchangeRateService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除汇率记录' })
  async remove(@Param('id') id: string) {
    return this.exchangeRateService.remove(id);
  }

  @Post('sync')
  @ApiOperation({ summary: '从外部 API 同步汇率' })
  async syncRates(@Body() dto: SyncExchangeRateDto) {
    return this.exchangeRateService.syncRates(dto);
  }
}
