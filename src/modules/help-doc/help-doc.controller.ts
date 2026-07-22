import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { HelpDocService } from './help-doc.service';
import {
  CreateHelpDocDto,
  UpdateHelpDocDto,
  QueryHelpDocDto,
} from './dto/help-doc.dto';

/**
 * 帮助文档接口
 * 管理端：CRUD（配合前端 help-doc:* 权限码）
 * 阅读端：已发布文档树 / 单篇 / 按路由匹配，全体登录用户可访问
 */
@ApiTags('帮助文档')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('help-docs')
export class HelpDocController {
  constructor(private readonly service: HelpDocService) {}

  @Get()
  @ApiOperation({ summary: '分页查询帮助文档（管理端）' })
  findAll(@Query() query: QueryHelpDocDto) {
    return this.service.findAll(query);
  }

  @Get('tree')
  @ApiOperation({ summary: '已发布文档树（阅读端，按分类分组）' })
  findPublishedTree() {
    return this.service.findPublishedTree();
  }

  @Get('match')
  @ApiOperation({ summary: '按当前路由匹配帮助文档（上下文帮助入口）' })
  matchByRoute(@Query('path') path: string) {
    return this.service.matchByRoute(path);
  }

  @Get('published/:id')
  @ApiOperation({ summary: '获取单篇已发布文档（阅读端）' })
  findOnePublished(@Param('id') id: string) {
    return this.service.findOnePublished(id);
  }

  @Get(':id')
  @ApiOperation({ summary: '帮助文档详情（管理端）' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建帮助文档' })
  create(@Body() dto: CreateHelpDocDto) {
    return this.service.create({
      title: dto.title,
      category: dto.category,
      content: dto.content,
      routePath: dto.routePath,
      sortOrder: dto.sortOrder ?? 0,
      status: dto.status ?? 1,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: '更新帮助文档' })
  update(@Param('id') id: string, @Body() dto: UpdateHelpDocDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '切换发布/草稿状态' })
  toggleStatus(@Param('id') id: string) {
    return this.service.toggleStatus(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除帮助文档' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
