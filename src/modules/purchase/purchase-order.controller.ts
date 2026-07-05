import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseOrderService } from './purchase-order.service';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  QueryPurchaseOrderDto,
} from './dto/purchase-order.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('采购订单')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Get()
  @ApiOperation({ summary: '采购订单列表（分页）' })
  findAll(@Query() query: QueryPurchaseOrderDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '采购订单详情（含明细）' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建采购订单' })
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '修改采购订单（仅待入库状态）' })
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/close')
  @ApiOperation({ summary: '关闭采购订单' })
  close(@Param('id') id: string) {
    return this.service.close(id);
  }
}
