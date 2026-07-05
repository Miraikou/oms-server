import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('驾驶舱')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'KPI 总览' })
  getOverview(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getOverview(startDate, endDate);
  }

  @Get('sales-trend')
  @ApiOperation({ summary: '销售趋势' })
  getSalesTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.service.getSalesTrend(startDate, endDate, granularity);
  }

  @Get('profit-trend')
  @ApiOperation({ summary: '利润趋势' })
  getProfitTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.service.getProfitTrend(startDate, endDate, granularity);
  }

  @Get('payment-trend')
  @ApiOperation({ summary: '收款趋势' })
  getPaymentTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.service.getPaymentTrend(startDate, endDate, granularity);
  }

  @Get('purchase-trend')
  @ApiOperation({ summary: '采购趋势' })
  getPurchaseTrend(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.service.getPurchaseTrend(startDate, endDate, granularity);
  }

  @Get('salesperson-ranking')
  @ApiOperation({ summary: '销售员排行榜' })
  getSalespersonRanking(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getSalespersonRanking(
      startDate,
      endDate,
      parseInt(limit || '10'),
    );
  }

  @Get('product-ranking')
  @ApiOperation({ summary: '商品排行榜' })
  getProductRanking(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getProductRanking(
      startDate,
      endDate,
      parseInt(limit || '10'),
    );
  }

  @Get('pending-items')
  @ApiOperation({ summary: '待处理事项' })
  getPendingItems() {
    return this.service.getPendingItems();
  }
}
