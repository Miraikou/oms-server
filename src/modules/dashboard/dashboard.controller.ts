import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('驾驶舱')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'KPI 总览' })
  getOverview(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('viewMode') viewMode?: string,
  ) {
    return this.service.getOverview(startDate, endDate, userId, viewMode);
  }

  @Get('sales-trend')
  @ApiOperation({ summary: '销售趋势' })
  getSalesTrend(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
    @Query('viewMode') viewMode?: string,
  ) {
    return this.service.getSalesTrend(startDate, endDate, granularity, userId, viewMode);
  }

  @Get('profit-trend')
  @ApiOperation({ summary: '利润趋势' })
  getProfitTrend(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
    @Query('viewMode') viewMode?: string,
  ) {
    return this.service.getProfitTrend(startDate, endDate, granularity, userId, viewMode);
  }

  @Get('payment-trend')
  @ApiOperation({ summary: '收款趋势' })
  getPaymentTrend(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
    @Query('viewMode') viewMode?: string,
  ) {
    return this.service.getPaymentTrend(startDate, endDate, granularity, userId, viewMode);
  }

  @Get('purchase-trend')
  @ApiOperation({ summary: '采购趋势' })
  getPurchaseTrend(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
    @Query('viewMode') viewMode?: string,
  ) {
    return this.service.getPurchaseTrend(startDate, endDate, granularity, userId, viewMode);
  }

  @Get('salesperson-ranking')
  @ApiOperation({ summary: '销售员排行榜' })
  getSalespersonRanking(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('viewMode') viewMode?: string,
  ) {
    return this.service.getSalespersonRanking(
      startDate,
      endDate,
      parseInt(limit || '10'),
      userId,
      viewMode,
    );
  }

  @Get('product-ranking')
  @ApiOperation({ summary: '商品排行榜' })
  getProductRanking(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('viewMode') viewMode?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    return this.service.getProductRanking(
      startDate,
      endDate,
      parseInt(limit || '10'),
      userId,
      viewMode,
      groupBy || 'product',
    );
  }

  @Get('pending-items')
  @ApiOperation({ summary: '待处理事项' })
  getPendingItems(
    @CurrentUser('sub') userId: string,
    @Query('viewMode') viewMode?: string,
  ) {
    return this.service.getPendingItems(userId, viewMode);
  }

  @Get('commission-summary')
  @ApiOperation({ summary: '提成汇总统计' })
  async getCommissionSummary(
    @CurrentUser('sub') userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('viewMode') viewMode?: string,
  ) {
    const salespersonId = await this.service.resolveSalespersonId(userId, viewMode);
    return this.service.getCommissionSummary(startDate, endDate, salespersonId);
  }
}
