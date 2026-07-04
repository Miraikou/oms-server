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
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { SalesOrderService } from './sales-order.service'
import { SalesOrderCostService } from './sales-order-cost.service'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import type {
  CreateSalesOrderDto,
  UpdateSalesOrderDto,
  QuerySalesOrderDto,
  CreateSalesOrderCostDto,
  UpdateSalesOrderCostDto,
} from './dto/sales-order.dto'

@ApiTags('销售订单')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-orders')
export class SalesOrderController {
  constructor(
    private readonly orderService: SalesOrderService,
    private readonly costService: SalesOrderCostService,
  ) {}

  @Get()
  @ApiOperation({ summary: '订单列表（分页）' })
  findAll(@Query() query: QuerySalesOrderDto) {
    return this.orderService.findAll(query)
  }

  @Get(':id')
  @ApiOperation({ summary: '订单详情（含明细 + 成本）' })
  async findOne(@Param('id') id: string) {
    const order = await this.orderService.findOne(id)
    const costs = await this.costService.findByOrderId(id)
    return { ...order, costs }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建订单（含库存冻结）' })
  create(@Body() dto: CreateSalesOrderDto) {
    return this.orderService.create(dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '修改订单（仅待发货状态）' })
  update(@Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
    return this.orderService.update(id, dto)
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '取消订单（含库存解冻）' })
  cancel(@Param('id') id: string) {
    return this.orderService.cancel(id)
  }

  // ========== 订单成本接口 ==========

  @Get(':orderId/costs')
  @ApiOperation({ summary: '获取订单成本列表' })
  getCosts(@Param('orderId') orderId: string) {
    return this.costService.findByOrderId(orderId)
  }

  @Post(':orderId/costs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '添加订单成本' })
  createCost(
    @Param('orderId') orderId: string,
    @Body() dto: CreateSalesOrderCostDto,
  ) {
    return this.costService.create(orderId, dto)
  }

  @Put(':orderId/costs/:costId')
  @ApiOperation({ summary: '修改订单成本' })
  updateCost(
    @Param('orderId') _orderId: string,
    @Param('costId') costId: string,
    @Body() dto: UpdateSalesOrderCostDto,
  ) {
    return this.costService.update(costId, dto)
  }

  @Delete(':orderId/costs/:costId')
  @ApiOperation({ summary: '删除订单成本' })
  deleteCost(
    @Param('orderId') _orderId: string,
    @Param('costId') costId: string,
  ) {
    return this.costService.remove(costId)
  }
}
