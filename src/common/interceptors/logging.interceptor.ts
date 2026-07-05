import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

/**
 * 全局日志拦截器
 * 记录每个请求的方法、路径、User-Agent、IP 和响应时间
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, headers } = request;
    const userAgent = headers['user-agent'] || 'unknown';
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        const statusCode = response.statusCode;
        const duration = Date.now() - now;
        const level = statusCode >= 400 ? 'warn' : 'log';

        this.logger[level](
          `${method} ${url} ${statusCode} ${duration}ms - ${ip} - ${userAgent}`,
        );
      }),
    );
  }
}
