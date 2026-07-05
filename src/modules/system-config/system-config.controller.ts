import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SystemConfigService } from './system-config.service';
import {
  CreateSystemConfigDto,
  UpdateSystemConfigDto,
} from './dto/system-config.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('系统参数')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('system-configs')
export class SystemConfigController {
  constructor(private readonly service: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: '分页查询系统参数' })
  findAll(
    @Query() query: { keyword?: string; page?: number; pageSize?: number },
  ) {
    return this.service.findAll(query);
  }

  @Get('map')
  @ApiOperation({ summary: '获取所有配置（key-value 对象）' })
  getAllAsMap() {
    return this.service.getAllAsMap();
  }

  @Get('key/:key')
  @ApiOperation({ summary: '根据 key 获取配置值' })
  getByKey(@Param('key') key: string) {
    return this.service.getByKey(key);
  }

  @Get(':id')
  @ApiOperation({ summary: '系统参数详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建系统参数' })
  create(@Body() dto: CreateSystemConfigDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新系统参数' })
  update(@Param('id') id: string, @Body() dto: UpdateSystemConfigDto) {
    return this.service.update(id, dto);
  }

  @Put('key/:key')
  @ApiOperation({ summary: '根据 key 更新配置值' })
  updateByKey(@Param('key') key: string, @Body('value') value: string) {
    return this.service.updateByKey(key, value);
  }
}
