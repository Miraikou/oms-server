import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/**
 * 当前登录用户信息接口
 */
export interface JwtPayload {
  /** 用户 ID */
  sub: string
  /** 用户名 */
  username: string
  /** 角色 ID 列表 */
  roles?: string[]
}

/**
 * 从请求对象中获取当前登录用户信息
 *
 * @example
 * ```ts
 * @Get('profile')
 * getProfile(@CurrentUser() user: JwtPayload) {
 *   return user
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user as JwtPayload | undefined
    if (!user) return undefined
    return data ? user[data] : user
  },
)
