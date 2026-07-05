import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard'
import { RoleService } from './role.service'
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { QueryRoleDto } from './dto/query-role.dto'
import { AssignMenusDto } from './dto/assign-menus.dto'

/**
 * 角色管理控制器
 */
@ApiTags('角色管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @ApiOperation({ summary: '角色列表（分页）' })
  findAll(@Query() query: QueryRoleDto) {
    return this.roleService.findAll(query)
  }

  @Get('all')
  @ApiOperation({ summary: '全部启用角色（下拉选项用）' })
  findAllActive() {
    return this.roleService.findAllActive()
  }

  @Get(':id')
  @ApiOperation({ summary: '角色详情（含已关联菜单 ID）' })
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '新增角色' })
  create(@Body() dto: CreateRoleDto) {
    return this.roleService.create(dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '修改角色' })
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roleService.update(id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  delete(@Param('id') id: string) {
    return this.roleService.delete(id)
  }

  @Put(':id/menus')
  @ApiOperation({ summary: '分配角色菜单权限' })
  assignMenus(@Param('id') id: string, @Body() dto: AssignMenusDto) {
    return this.roleService.assignMenus(id, dto.menuIds)
  }
}
