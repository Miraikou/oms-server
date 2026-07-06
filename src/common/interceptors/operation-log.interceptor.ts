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

    // 只记录写操作
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const startTime = Date.now();
    const uri = req.originalUrl || req.url;
    const moduleKey =
      Object.keys(MODULE_MAP).find((k) => uri.startsWith(`/api/v1${k}`)) || '';
    const module = MODULE_MAP[moduleKey] || '其他';
    const businessType = `${METHOD_MAP[method] || method}${module}`;

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
            operationContent: `${method} ${uri}`,
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
            operationContent: `${method} ${uri}`,
          });
        },
      }),
    );
  }
}
