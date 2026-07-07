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
import { CostTypeService } from './cost-type.service';
import {
  CreateCostTypeDto,
  UpdateCostTypeDto,
  QueryCostTypeDto,
} from './dto/cost-type.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('成本类型')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cost-types')
export class CostTypeController {
  constructor(private readonly service: CostTypeService) {}

  @Get()
  @ApiOperation({ summary: '分页查询成本类型' })
  findAll(@Query() query: QueryCostTypeDto) {
    return this.service.findAll(query);
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有启用成本类型' })
  findAllActive() {
    return this.service.findAllActive();
  }

  @Get(':id')
  @ApiOperation({ summary: '成本类型详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建成本类型' })
  create(@Body() dto: CreateCostTypeDto) {
    return this.service.create({
      costName: dto.costName,
      sortNo: dto.sortNo || 0,
      remark: dto.remark,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: '更新成本类型' })
  update(@Param('id') id: string, @Body() dto: UpdateCostTypeDto) {
    const data: Record<string, unknown> = {};
    if (dto.costName !== undefined) data.costName = dto.costName;
    if (dto.sortNo !== undefined) data.sortNo = dto.sortNo;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.remark !== undefined) data.remark = dto.remark;
    return this.service.update(id, data);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换成本类型状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }
}
