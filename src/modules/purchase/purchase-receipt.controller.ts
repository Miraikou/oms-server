import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { PurchaseReceiptService } from './purchase-receipt.service'
import { CreatePurchaseReceiptDto, QueryPurchaseReceiptDto } from './dto/purchase-receipt.dto'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

@ApiTags('采购入库')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('purchase-receipts')
export class PurchaseReceiptController {
  constructor(private readonly service: PurchaseReceiptService) {}

  @Get()
  @ApiOperation({ summary: '入库记录列表（分页）' })
  findAll(@Query() query: QueryPurchaseReceiptDto) {
    return this.service.findAll(query)
  }

  @Get(':id')
  @ApiOperation({ summary: '入库记录详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建入库（8 步事务）' })
  create(@Body() dto: CreatePurchaseReceiptDto) {
    return this.service.createReceipt(dto)
  }
}
