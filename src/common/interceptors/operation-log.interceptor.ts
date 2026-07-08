import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { OperationLogService } from '@/modules/operation-log/operation-log.service';

/** 模块名映射（URL 前缀 → 中文模块名） */
const MODULE_MAP: Record<string, string> = {
  '/auth': '认证管理',
  '/users': '用户管理',
  '/roles': '角色管理',
  '/menus': '菜单管理',
  '/suppliers': '供应商管理',
  '/categories': '分类管理',
  '/products': '商品管理',
  '/salespersons': '销售员管理',
  '/express-companies': '快递公司',
  '/transport-channels': '运输渠道',
  '/cost-types': '成本类型',
  '/system-configs': '系统参数',
  '/common-contacts': '常用联系人',
  '/sales-orders': '销售订单',
  '/purchase-orders': '采购订单',
  '/purchase-receipts': '采购入库',
  '/shipments': '发货管理',
  '/payments': '收款管理',
  '/inventories': '库存管理',
  '/inventory-flows': '库存流水',
  '/inventory-adjustments': '库存调整',
  '/sales-returns': '客户退货',
  '/purchase-returns': '采购退货',
  '/dashboard': '驾驶舱',
  '/operation-logs': '操作日志',
  '/dictionaries': '字典管理',
  '/upload': '文件上传',
};

/** 业务类型映射（HTTP 方法 → 业务类型） */
const METHOD_MAP: Record<string, string> = {
  POST: '新增',
  PUT: '修改',
  PATCH: '修改',
  DELETE: '删除',
};

/** 清理请求 body，过滤二进制/large 字段，截断过长内容 */
function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  if (Array.isArray(body)) return body.map(sanitizeBody)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === 'image' || key === 'file' || key === 'password') {
      result[key] = '[FILTERED]'
    } else if (typeof value === 'string' && value.length > 500) {
      result[key] = value.substring(0, 500) + '...'
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeBody(value)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * 操作日志拦截器
 * 自动记录所有非 GET 请求的操作日志
 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  constructor(private readonly logService: OperationLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method.toUpperCase();

    // 只记录写操作，排除无需记录的路由
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const uri = req.originalUrl || req.url;

    // 排除列表：Token 刷新等无需记录的接口
    const SKIP_URIS = ['/api/v1/auth/refresh', '/api/v1/auth/login'];
    if (SKIP_URIS.some((skip) => uri.startsWith(skip))) {
      return next.handle();
    }
    const moduleKey =
      Object.keys(MODULE_MAP).find((k) => uri.startsWith(`/api/v1${k}`)) || '';
    const module = MODULE_MAP[moduleKey] || '其他';
    const businessType = `${METHOD_MAP[method] || method}${module}`;

    // 序列化请求参数（过滤掉文件和超大 body）
    const params = {
      query: (req as unknown as Record<string, unknown>).query,
      body: sanitizeBody(req.body),
    }
    const operationContent = JSON.stringify(params, null, 2)

    return next.handle().pipe(
      tap({
        next: () => {
          void this.logService.create({
            module,
            businessType,
            requestMethod: method,
            requestUri: uri,
            requestIp: (req.ip || req.socket.remoteAddress) ?? undefined,
            operationResult: 1,
            operationContent,
          });
        },
        error: () => {
          void this.logService.create({
            module,
            businessType,
            requestMethod: method,
            requestUri: uri,
            requestIp: (req.ip || req.socket.remoteAddress) ?? undefined,
            operationResult: 0,
            operationContent,
          });
        },
      }),
    );
  }
}
