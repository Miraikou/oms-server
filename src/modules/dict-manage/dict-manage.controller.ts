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
import { DictTypeService } from './dict-type.service';
import { DictItemService } from './dict-item.service';
import {
  CreateDictTypeDto,
  UpdateDictTypeDto,
  QueryDictTypeDto,
  CreateDictItemDto,
  UpdateDictItemDto,
  QueryDictItemDto,
} from './dto/dict-manage.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

// ==================== 字典类型接口 ====================

@ApiTags('字典类型')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dict-types')
export class DictTypeController {
  constructor(private readonly service: DictTypeService) {}

  @Get()
  @ApiOperation({ summary: '分页查询字典类型' })
  findAll(@Query() query: QueryDictTypeDto) {
    return this.service.findAll(query);
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有启用字典类型' })
  findAllActive() {
    return this.service.findAllActive();
  }

  @Get(':id')
  @ApiOperation({ summary: '字典类型详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建字典类型' })
  create(@Body() dto: CreateDictTypeDto) {
    return this.service.create({
      typeCode: dto.typeCode,
      typeName: dto.typeName,
      remark: dto.remark,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: '更新字典类型' })
  update(@Param('id') id: string, @Body() dto: UpdateDictTypeDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换字典类型状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }
}

// ==================== 字典项接口 ====================

@ApiTags('字典项')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dict-items')
export class DictItemController {
  constructor(private readonly service: DictItemService) {}

  @Get()
  @ApiOperation({ summary: '分页查询字典项' })
  findAll(@Query() query: QueryDictItemDto) {
    return this.service.findAll(query);
  }

  @Get('all')
  @ApiOperation({ summary: '按字典编码获取所有启用字典项' })
  findAllByType(@Query('typeCode') typeCode: string) {
    return this.service.findAll({ typeCode, status: 1, page: 1, pageSize: 9999 });
  }

  @Get(':id')
  @ApiOperation({ summary: '字典项详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建字典项' })
  create(@Body() dto: CreateDictItemDto) {
    return this.service.create({
      typeCode: dto.typeCode,
      itemValue: dto.itemValue,
      itemLabel: dto.itemLabel,
      sortOrder: dto.sortOrder || 0,
      remark: dto.remark,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: '更新字典项' })
  update(@Param('id') id: string, @Body() dto: UpdateDictItemDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换字典项状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }
}
