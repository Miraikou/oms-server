import { SetMetadata } from '@nestjs/common';

/** 权限元数据键 */
export const PERMISSION_KEY = 'permission';

/**
 * 接口权限装饰器
 * 标记接口所需的权限标识，配合 PermissionGuard 使用
 *
 * @example
 * ```ts
 * @RequirePermission('order:create')
 * @Post()
 * create(@Body() dto: CreateOrderDto) { ... }
 * ```
 */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);
