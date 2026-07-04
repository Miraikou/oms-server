import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { InventoryAdjustmentService } from './inventory-adjustment.service'
import { CreateInventoryAdjustmentDto, QueryInventoryAdjustmentDto } from './dto/inventory-adjustment.dto'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

@ApiTags('库存调整')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory-adjustments')
export class InventoryAdjustmentController {
  constructor(private readonly service: InventoryAdjustmentService) {}

  @Get()
  @ApiOperation({ summary: '库存调整列表（分页）' })
  findAll(@Query() query: QueryInventoryAdjustmentDto) {
    return this.service.findAll(query)
  }

  @Get(':id')
  @ApiOperation({ summary: '库存调整详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建库存调整' })
  create(@Body() dto: CreateInventoryAdjustmentDto) {
    return this.service.create(dto)
  }
}
