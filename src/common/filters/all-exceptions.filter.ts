import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * 全局异常过滤器
 * 统一所有异常的响应格式：{ code, message, data, timestamp }
 *
 * 错误码体系：
 * - 40000: 参数校验错误
 * - 41000: 权限错误
 * - 42000: 业务逻辑错误
 * - 50000: 系统内部错误
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = 50000;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || exception.message;
        code = (resp.code as number) || this.mapStatusToCode(status);
        // class-validator 返回的错误消息可能是数组
        if (Array.isArray(resp.message)) {
          message = (resp.message as string[]).join('; ');
        }
      }

      if (code === 50000) {
        code = this.mapStatusToCode(status);
      }
    } else if (exception instanceof QueryFailedError) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = '数据库操作失败';
      code = 50000;
    }

    response.status(status).json({
      code,
      message,
      data: null,
      timestamp: Date.now(),
    });
  }

  /**
   * 将 HTTP 状态码映射为业务错误码
   */
  private mapStatusToCode(status: number): number {
    if (status === Number(HttpStatus.BAD_REQUEST)) return 40000;
    if (status === Number(HttpStatus.UNAUTHORIZED)) return 41000;
    if (status === Number(HttpStatus.FORBIDDEN)) return 41000;
    if (status === Number(HttpStatus.NOT_FOUND)) return 40000;
    if (status === Number(HttpStatus.CONFLICT)) return 42000;
    if (status >= 400 && status < 500) return 42000;
    return 50000;
  }
}
