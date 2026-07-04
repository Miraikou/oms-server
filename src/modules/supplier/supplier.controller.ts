import {
  Controller, Get, Post, Put, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { SupplierService } from './supplier.service'
import { CreateSupplierDto, UpdateSupplierDto, QuerySupplierDto } from './dto/supplier.dto'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

@ApiTags('供应商')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  @Get()
  @ApiOperation({ summary: '分页查询供应商' })
  findAll(@Query() query: QuerySupplierDto) {
    return this.service.findAll(query)
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有启用供应商' })
  findAllActive() {
    return this.service.findAllActive()
  }

  @Get(':id')
  @ApiOperation({ summary: '供应商详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建供应商' })
  create(@Body() dto: CreateSupplierDto) {
    return this.service.create(dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '更新供应商' })
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.service.update(id, dto)
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换供应商状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id)
  }
}
