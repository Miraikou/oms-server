import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { LoginLogService } from './login-log.service'

/**
 * 登录日志控制器
 * 提供登录日志的查询接口
 */
@ApiTags('登录日志')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('login-logs')
export class LoginLogController {
  constructor(private readonly loginLogService: LoginLogService) {}

  @Get()
  @ApiOperation({ summary: '登录日志列表（分页）' })
  findAll(
    @Query('username') username?: string,
    @Query('loginResult') loginResult?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.loginLogService.findAll({
      username,
      loginResult: loginResult !== undefined ? Number(loginResult) : undefined,
      startTime,
      endTime,
      page,
      pageSize,
    })
  }

  @Get(':id')
  @ApiOperation({ summary: '登录日志详情' })
  findOne(@Param('id') id: string) {
    return this.loginLogService.findOne(id)
  }
}
