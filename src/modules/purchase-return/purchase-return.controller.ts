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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseReturnService } from './purchase-return.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import {
  CreatePurchaseReturnDto,
  QueryPurchaseReturnDto,
} from './dto/purchase-return.dto';

@ApiTags('采购退货')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('purchase-returns')
export class PurchaseReturnController {
  constructor(private readonly service: PurchaseReturnService) {}

  @Get()
  @ApiOperation({ summary: '采购退货列表（分页）' })
  findAll(@Query() query: QueryPurchaseReturnDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '采购退货详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新建采购退货' })
  create(@Body() dto: CreatePurchaseReturnDto) {
    return this.service.create(dto);
  }
}
