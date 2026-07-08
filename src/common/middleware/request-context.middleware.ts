import { Injectable, NestMiddleware } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import { requestContext } from '../context/request-context'

/**
 * 请求上下文中间件
 * 在每个请求开始时初始化 AsyncLocalStorage，将当前用户 ID 注入上下文
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const user = (req as unknown as { user?: { sub: string } }).user
    const userId = user?.sub

    requestContext.run({ userId }, () => {
      next()
    })
  }
}
