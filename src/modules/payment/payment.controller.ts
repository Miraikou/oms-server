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
import { PaymentService } from './payment.service'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { CreatePaymentDto, QueryPaymentDto } from './dto/payment.dto'

@ApiTags('收款管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @Get()
  @ApiOperation({ summary: '收款列表（分页）' })
  findAll(@Query() query: QueryPaymentDto) {
    return this.service.findAll(query)
  }

  @Get(':id')
  @ApiOperation({ summary: '收款详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建收款' })
  create(@Body() dto: CreatePaymentDto) {
    return this.service.create(dto)
  }
}
