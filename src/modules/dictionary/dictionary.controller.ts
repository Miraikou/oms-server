import { Controller, Get, Delete, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger'
import { DictionaryService } from './dictionary.service'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'

/**
 * 字典控制器
 * 提供固定字典和动态字典的查询接口
 */
@ApiTags('字典')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dictionaries')
export class DictionaryController {
  constructor(private readonly service: DictionaryService) {}

  @Get('fixed')
  @ApiOperation({ summary: '获取所有固定字典（枚举）' })
  getFixedDictionaries() {
    return this.service.getFixedDictionaries()
  }

  @Get(':type')
  @ApiOperation({ summary: '获取指定动态字典' })
  @ApiParam({ name: 'type', description: '字典类型（如 COST_TYPE、EXPRESS_COMPANY 等）' })
  getDynamicDictionary(@Param('type') type: string) {
    return this.service.getDynamicDictionary(type.toUpperCase())
  }

  @Delete(':type/cache')
  @ApiOperation({ summary: '清除指定动态字典缓存' })
  @ApiParam({ name: 'type', description: '字典类型' })
  async invalidateCache(@Param('type') type: string) {
    await this.service.invalidateCache(type.toUpperCase())
    return { success: true }
  }
}
