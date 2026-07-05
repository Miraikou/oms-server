import { Controller, Get, Param, Query, UseGuards, NotFoundException } from '@nestjs/common'
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
    // 安全转换 loginResult：空字符串和非数字字符串均视为未传入
    const loginResultNum =
      loginResult !== undefined && loginResult !== ''
        ? Number(loginResult)
        : undefined
    const safeLoginResult =
      loginResultNum !== undefined && !isNaN(loginResultNum)
        ? loginResultNum
        : undefined

    return this.loginLogService.findAll({
      username,
      loginResult: safeLoginResult,
      startTime,
      endTime,
      page,
      pageSize,
    })
  }

  @Get(':id')
  @ApiOperation({ summary: '登录日志详情' })
  async findOne(@Param('id') id: string) {
    const log = await this.loginLogService.findOne(id)
    if (!log) {
      throw new NotFoundException(`登录日志 ${id} 不存在`)
    }
    return log
  }
}
