import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductModelService } from './product-model.service';
import {
  CreateProductModelDto,
  UpdateProductModelDto,
  QueryProductModelDto,
} from './dto/product-model.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('商品型号')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products/:productId/models')
export class ProductModelController {
  constructor(private readonly service: ProductModelService) {}

  @Get()
  @ApiOperation({ summary: '分页查询商品型号' })
  findAll(
    @Param('productId') productId: string,
    @Query() query: QueryProductModelDto,
  ) {
    return this.service.findAll(productId, query);
  }

  @Get('all')
  @ApiOperation({ summary: '获取该商品所有启用型号（下拉用）' })
  findAllActive(@Param('productId') productId: string) {
    return this.service.findAllActive(productId);
  }

  @Get(':id')
  @ApiOperation({ summary: '型号详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新增型号' })
  create(
    @Param('productId') productId: string,
    @Body() dto: CreateProductModelDto,
  ) {
    return this.service.create(productId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新型号' })
  update(@Param('id') id: string, @Body() dto: UpdateProductModelDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换型号状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除型号' })
  remove(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
