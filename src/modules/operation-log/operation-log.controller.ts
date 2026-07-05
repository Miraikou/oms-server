import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OperationLogService } from './operation-log.service';

/**
 * 操作日志控制器
 * 仅提供查询接口，日志写入通过 Service 内部调用
 */
@ApiTags('操作日志')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('operation-logs')
export class OperationLogController {
  constructor(private readonly logService: OperationLogService) {}

  @Get()
  @ApiOperation({ summary: '操作日志列表（分页）' })
  findAll(
    @Query('module') module?: string,
    @Query('businessType') businessType?: string,
    @Query('createdBy') createdBy?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.logService.findAll({
      module,
      businessType,
      createdBy,
      startTime,
      endTime,
      page,
      pageSize,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '日志详情' })
  findOne(@Param('id') id: string) {
    return this.logService.findOne(id);
  }
}
