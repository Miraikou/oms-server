import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { ShipmentService } from './shipment.service'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { CreateShipmentDto, QueryShipmentDto } from './dto/shipment.dto'

@ApiTags('发货管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentController {
  constructor(private readonly service: ShipmentService) {}

  @Get()
  @ApiOperation({ summary: '发货列表（分页）' })
  findAll(@Query() query: QueryShipmentDto) {
    return this.service.findAll(query)
  }

  @Get('preview/:orderId')
  @ApiOperation({ summary: '发货预览（可发商品 + FIFO 预估批次）' })
  preview(@Param('orderId') orderId: string) {
    return this.service.preview(orderId)
  }

  @Get(':id')
  @ApiOperation({ summary: '发货详情（含明细 + 批次）' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建发货（8 步事务）' })
  create(@Body() dto: CreateShipmentDto) {
    return this.service.create(dto)
  }
}
