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
import { SalesReturnService } from './sales-return.service'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { CreateSalesReturnDto, QuerySalesReturnDto } from './dto/sales-return.dto'

@ApiTags('客户退货')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales-returns')
export class SalesReturnController {
  constructor(private readonly service: SalesReturnService) {}

  @Get()
  @ApiOperation({ summary: '客户退货列表（分页）' })
  findAll(@Query() query: QuerySalesReturnDto) {
    return this.service.findAll(query)
  }

  @Get(':id')
  @ApiOperation({ summary: '客户退货详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建客户退货' })
  create(@Body() dto: CreateSalesReturnDto) {
    return this.service.create(dto)
  }
}
