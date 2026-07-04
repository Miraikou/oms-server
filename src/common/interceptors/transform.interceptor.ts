import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { ApiResponseDto } from '../dto/response.dto'

/**
 * 全局响应转换拦截器
 * 将所有成功响应包装为统一格式：{ code: 0, message: 'success', data, timestamp }
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponseDto<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponseDto<T>> {
    return next.handle().pipe(
      map((data: T) => ({
        code: 0,
        message: 'success',
        data,
        timestamp: Date.now(),
      })),
    )
  }
}
