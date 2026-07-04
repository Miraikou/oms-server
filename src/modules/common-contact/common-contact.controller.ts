import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { CommonContactService } from './common-contact.service'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

@ApiTags('常用联系人')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('common-contacts')
export class CommonContactController {
  constructor(private readonly service: CommonContactService) {}

  @Get()
  @ApiOperation({ summary: '分页查询常用联系人' })
  findAll(@Query() query: { keyword?: string; page?: number; pageSize?: number }) {
    return this.service.findAll(query)
  }

  @Get('frequent')
  @ApiOperation({ summary: '按使用频率获取常用联系人' })
  findByUsage(@Query('limit') limit?: number) {
    return this.service.findByUsage(limit || 20)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建常用联系人' })
  create(@Body('contactName') contactName: string) {
    return this.service.create({ contactName })
  }

  @Put(':id')
  @ApiOperation({ summary: '更新常用联系人' })
  update(@Param('id') id: string, @Body('contactName') contactName: string) {
    return this.service.update(id, { contactName })
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除常用联系人' })
  async remove(@Param('id') id: string) {
    await this.service.findOne(id) // 确保存在
    // CommonContact 允许物理删除（不影响业务数据）
    const repo = (this.service as any).repo
    await repo.delete(id)
    return null
  }
}
