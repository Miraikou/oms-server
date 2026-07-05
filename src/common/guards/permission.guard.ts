import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { DataSource } from 'typeorm'
import { PERMISSION_KEY } from '../decorators/require-permission.decorator'

/**
 * 权限守卫
 * 检查当前用户是否拥有接口所需的权限标识
 * SUPER_ADMIN 角色直接放行
 * 使用单次 JOIN 查询替代 N+1 查询
 *
 * 使用方式：在控制器方法上添加 @RequirePermission('xxx') + @UseGuards(PermissionGuard)
 * 如果没有 @RequirePermission 装饰器，则跳过权限检查（仅验证 JWT）
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
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

    // 单次 JOIN 查询：用户 → 活跃角色 → 角色菜单 → 菜单权限
    const rows: Array<{
      roleCode: string
      permission: string | null
    }> = await this.dataSource.query(
      `SELECT r.role_code AS roleCode, m.permission
       FROM sys_user_role ur
       INNER JOIN sys_role r ON ur.role_id = r.id AND r.status = 1
       INNER JOIN sys_role_menu rm ON r.id = rm.role_id
       INNER JOIN sys_menu m ON rm.menu_id = m.id AND m.menu_type = 2 AND m.status = 1
       WHERE ur.user_id = ?`,
      [userId],
    )

    if (rows.length === 0) {
      throw new ForbiddenException('没有操作权限')
    }

    // SUPER_ADMIN 直接放行
    const isSuperAdmin = rows.some((r) => r.roleCode === 'SUPER_ADMIN')
    if (isSuperAdmin) {
      return true
    }

    // 收集活跃角色对应的权限（已过滤禁用角色，JOIN 条件 r.status = 1）
    const permissions = new Set(
      rows.map((r) => r.permission).filter((p): p is string => p !== null),
    )

    if (permissions.has(requiredPermission)) {
      return true
    }

    throw new ForbiddenException('没有操作权限')
  }
}
