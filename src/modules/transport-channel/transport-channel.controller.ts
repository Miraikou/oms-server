import { Controller, Get, Post, Put, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { TransportChannelService } from './transport-channel.service'
import { CreateNameDto, UpdateNameDto, QueryNameDto } from '@/common/dto/name.dto'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

@ApiTags('运输渠道')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transport-channels')
export class TransportChannelController {
  constructor(private readonly service: TransportChannelService) {}

  @Get()
  @ApiOperation({ summary: '分页查询运输渠道' })
  findAll(@Query() query: QueryNameDto) { return this.service.findAll(query) }

  @Get('all')
  @ApiOperation({ summary: '获取所有启用运输渠道' })
  findAllActive() { return this.service.findAllActive() }

  @Get(':id')
  @ApiOperation({ summary: '运输渠道详情' })
  findOne(@Param('id') id: string) { return this.service.findOne(id) }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建运输渠道' })
  create(@Body() dto: CreateNameDto) {
    return this.service.create({ channelName: dto.name, remark: dto.remark })
  }

  @Put(':id')
  @ApiOperation({ summary: '更新运输渠道' })
  update(@Param('id') id: string, @Body() dto: UpdateNameDto) {
    const data: Record<string, unknown> = {}
    if (dto.name !== undefined) data.channelName = dto.name
    if (dto.status !== undefined) data.status = dto.status
    if (dto.remark !== undefined) data.remark = dto.remark
    return this.service.update(id, data)
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换运输渠道状态' })
  toggleStatus(@Param('id') id: string) { return this.service.toggleStatus(id) }
}
