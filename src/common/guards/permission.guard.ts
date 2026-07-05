import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { PERMISSION_KEY } from '../decorators/require-permission.decorator'
import { SysUserRole } from '@/modules/role/entities/sys-user-role.entity'
import { SysRole } from '@/modules/role/entities/sys-role.entity'
import { SysRoleMenu } from '@/modules/menu/entities/sys-role-menu.entity'
import { SysMenu } from '@/modules/menu/entities/sys-menu.entity'

/**
 * 权限守卫
 * 检查当前用户是否拥有接口所需的权限标识
 * SUPER_ADMIN 角色直接放行
 *
 * 使用方式：在控制器方法上添加 @RequirePermission('xxx') + @UseGuards(PermissionGuard)
 * 如果没有 @RequirePermission 装饰器，则跳过权限检查（仅验证 JWT）
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(SysUserRole)
    private readonly userRoleRepo: Repository<SysUserRole>,
    @InjectRepository(SysRole)
    private readonly roleRepo: Repository<SysRole>,
    @InjectRepository(SysRoleMenu)
    private readonly roleMenuRepo: Repository<SysRoleMenu>,
    @InjectRepository(SysMenu)
    private readonly menuRepo: Repository<SysMenu>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 获取接口所需权限标识
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    )

    // 如果接口没有标记权限要求，直接放行
    if (!requiredPermission) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user || !user.sub) {
      throw new ForbiddenException('未登录')
    }

    const userId = user.sub

    // 1. 查询用户角色
    const userRoles = await this.userRoleRepo.find({ where: { userId } })
    if (userRoles.length === 0) {
      throw new ForbiddenException('没有操作权限')
    }

    const roleIds = userRoles.map((ur) => ur.roleId)

    // 2. 检查是否有 SUPER_ADMIN 角色（直接放行）
    const roles = await this.roleRepo
      .createQueryBuilder('role')
      .where('role.id IN (:...roleIds)', { roleIds })
      .andWhere('role.status = :status', { status: 1 })
      .getMany()

    const isSuperAdmin = roles.some((r) => r.roleCode === 'SUPER_ADMIN')
    if (isSuperAdmin) {
      return true
    }

    // 3. 查询角色关联的菜单权限
    const roleMenus = await this.roleMenuRepo
      .createQueryBuilder('rm')
      .where('rm.roleId IN (:...roleIds)', { roleIds })
      .getMany()

    const menuIds = [...new Set(roleMenus.map((rm) => rm.menuId))]

    // 4. 查询菜单权限标识
    const menus = await this.menuRepo
      .createQueryBuilder('menu')
      .where('menu.id IN (:...menuIds)', { menuIds })
      .andWhere('menu.menuType = :menuType', { menuType: 2 }) // 仅按钮
      .andWhere('menu.status = :status', { status: 1 })
      .getMany()

    const userPermissions = menus
      .map((m) => m.permission)
      .filter(Boolean) as string[]

    // 5. 匹配权限
    if (userPermissions.includes(requiredPermission)) {
      return true
    }

    throw new ForbiddenException('没有操作权限')
  }
}
