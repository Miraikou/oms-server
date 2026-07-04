import {
  Controller, Get, Post, Put, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { CategoryService } from './category.service'
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

@ApiTags('商品分类')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  @Get('tree')
  @ApiOperation({ summary: '获取分类树' })
  getTree() {
    return this.service.getTree()
  }

  @Get()
  @ApiOperation({ summary: '分页查询分类' })
  findAll(@Query() query: { keyword?: string; status?: number; page?: number; pageSize?: number }) {
    return this.service.findAll(query)
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有启用分类' })
  findAllActive() {
    return this.service.findAllActive()
  }

  @Get(':id')
  @ApiOperation({ summary: '分类详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建分类' })
  create(@Body() dto: CreateCategoryDto) {
    return this.service.create(dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '更新分类' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.update(id, dto)
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换分类状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id)
  }
}
