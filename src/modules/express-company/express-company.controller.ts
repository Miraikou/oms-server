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
import { ExpressCompanyService } from './express-company.service';
import {
  CreateExpressCompanyDto,
  UpdateExpressCompanyDto,
  QueryExpressCompanyDto,
} from './dto/express-company.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('快递公司')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('express-companies')
export class ExpressCompanyController {
  constructor(private readonly service: ExpressCompanyService) {}

  @Get()
  @ApiOperation({ summary: '分页查询快递公司' })
  findAll(@Query() query: QueryExpressCompanyDto) {
    return this.service.findAll(query);
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有启用快递公司' })
  findAllActive() {
    return this.service.findAllActive();
  }

  @Get(':id')
  @ApiOperation({ summary: '快递公司详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建快递公司' })
  create(@Body() dto: CreateExpressCompanyDto) {
    return this.service.create({ companyName: dto.companyName, remark: dto.remark });
  }

  @Put(':id')
  @ApiOperation({ summary: '更新快递公司' })
  update(@Param('id') id: string, @Body() dto: UpdateExpressCompanyDto) {
    return this.service.update(id, dto)
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换快递公司状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }
}
