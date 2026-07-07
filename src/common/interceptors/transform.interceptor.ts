import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponseDto } from '../dto/response.dto';

/**
 * 去除 decimal 字符串的尾随零
 * 例如 "4.1000" → "4.1", "4.0000" → "4", "4.1230" → "4.123"
 */
function normalizeDecimal(value: unknown): unknown {
  if (typeof value === 'string' && /^\d+\.\d+$/.test(value)) {
    return value.replace(/\.?0+$/, '')
  }
  if (Array.isArray(value)) {
    return value.map(normalizeDecimal)
  }
  if (value instanceof Date) return value
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = normalizeDecimal((value as Record<string, unknown>)[key])
    }
    return result
  }
  return value
}

/**
 * 全局响应转换拦截器
 * 将所有成功响应包装为统一格式：{ code: 0, message: 'success', data, timestamp }
 * 同时自动去除 decimal 字段的尾随零
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponseDto<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponseDto<T>> {
    return next.handle().pipe(
      map((data: T) => ({
        code: 0,
        message: 'success',
        data: normalizeDecimal(data) as T,
        timestamp: Date.now(),
      })),
    );
  }
}
