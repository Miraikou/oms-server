import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'
import { requestContext } from '../context/request-context'
import type { Request } from 'express'

/**
 * 用户上下文拦截器
 * 在请求进入 handler 之前，将 JWT 中的用户 ID 注入到 AsyncLocalStorage，
 * 供 TypeORM Subscriber 自动填充 createdBy / updatedBy
 */
@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>()
    const user = (req as unknown as { user?: { sub: string; username: string } }).user
    if (user?.sub) {
      requestContext.setUser({ userId: user.sub, username: user.username })
    }
    return next.handle()
  }
}
