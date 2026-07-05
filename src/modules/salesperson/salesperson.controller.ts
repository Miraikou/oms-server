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
import { SalespersonService } from './salesperson.service';
import {
  CreateSalespersonDto,
  UpdateSalespersonDto,
} from './dto/salesperson.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('销售员')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('salespersons')
export class SalespersonController {
  constructor(private readonly service: SalespersonService) {}

  @Get()
  @ApiOperation({ summary: '分页查询销售员' })
  findAll(
    @Query()
    query: {
      keyword?: string;
      status?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.service.findAll(query);
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有启用销售员' })
  findAllActive() {
    return this.service.findAllActive();
  }

  @Get(':id')
  @ApiOperation({ summary: '销售员详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建销售员' })
  create(@Body() dto: CreateSalespersonDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新销售员' })
  update(@Param('id') id: string, @Body() dto: UpdateSalespersonDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换销售员状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }
}
