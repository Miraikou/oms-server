import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SalesOrderService } from './sales-order.service';
import { SalesOrderCostService } from './sales-order-cost.service';
import { DashboardService } from '@/modules/dashboard/dashboard.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionGuard } from '@/common/guards/permission.guard';
import { RequirePermission } from '@/common/decorators/require-permission.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Payment } from '@/modules/payment/entities/payment.entity';
import {
  CreateSalesOrderDto,
  UpdateSalesOrderDto,
  QuerySalesOrderDto,
  CreateSalesOrderCostDto,
  UpdateSalesOrderCostDto,
} from './dto/sales-order.dto';

@ApiTags('销售订单')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-orders')
export class SalesOrderController {
  constructor(
    private readonly orderService: SalesOrderService,
    private readonly costService: SalesOrderCostService,
    private readonly dashboardService: DashboardService,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
  ) {}

  @Get()
  @ApiOperation({ summary: '订单列表（分页）' })
  async findAll(
    @Query() query: QuerySalesOrderDto,
    @CurrentUser('sub') userId: string,
    @Query('viewMode') viewMode?: string,
  ) {
    // 根据视图模式自动过滤销售员（使用独立的订单全局查看权限）
    const salespersonId = await this.dashboardService.resolveSalespersonId(userId, viewMode, 'order:view-all');
    if (salespersonId) {
      query.salespersonId = salespersonId;
    }
    return this.orderService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情（含明细 + 成本 + 利润摘要 + 收退款）' })
  async findOne(@Param('id') id: string) {
    const order = await this.orderService.findOne(id);
    const costs = await this.costService.findByOrderId(id);
    const profitSummary = await this.orderService.getProfitSummary(id);
    const payments = await this.paymentRepo.find({
      where: { orderId: id, type: 1 },
      order: { paymentDate: 'ASC' },
    });
    const refunds = await this.paymentRepo.find({
      where: { orderId: id, type: 2 },
      order: { paymentDate: 'ASC' },
    });
    return { ...order, items: order.items, costs, profitSummary, payments, refunds };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建订单（含库存冻结）' })
  create(@Body() dto: CreateSalesOrderDto) {
    return this.orderService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '修改订单（仅待发货状态）' })
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.orderService.update(id, dto);
  }

  @Post(':id/cancel')
  @RequirePermission('order:cancel')
  @UseGuards(PermissionGuard)
  @ApiOperation({ summary: '取消订单（含库存解冻）' })
  cancel(@Param('id') id: string) {
    return this.orderService.cancel(id);
  }

  @Post(':id/terminate')
  @RequirePermission('order:terminate')
  @UseGuards(PermissionGuard)
  @ApiOperation({ summary: '终止订单（部分发货后弃购未发部分，解冻+退款+完成）' })
  terminate(@Param('id') id: string) {
    return this.orderService.terminate(id);
  }

  // ========== 订单成本接口 ==========

  @Get(':orderId/costs')
  @ApiOperation({ summary: '获取订单成本列表' })
  getCosts(@Param('orderId') orderId: string) {
    return this.costService.findByOrderId(orderId);
  }

  @Post(':orderId/costs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '添加订单成本' })
  createCost(
    @Param('orderId') orderId: string,
    @Body() dto: CreateSalesOrderCostDto,
  ) {
    return this.costService.create(orderId, dto);
  }

  @Put(':orderId/costs/:costId')
  @ApiOperation({ summary: '修改订单成本' })
  updateCost(
    @Param('orderId') _orderId: string,
    @Param('costId') costId: string,
    @Body() dto: UpdateSalesOrderCostDto,
  ) {
    return this.costService.update(costId, dto);
  }

  @Delete(':orderId/costs/:costId')
  @ApiOperation({ summary: '删除订单成本' })
  deleteCost(
    @Param('orderId') _orderId: string,
    @Param('costId') costId: string,
  ) {
    return this.costService.remove(costId);
  }
}
