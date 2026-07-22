import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RateService } from '@/common/rate/rate.service';
import { SystemConfigService } from '@/modules/system-config/system-config.service';
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity';

/** 查询结果行（TypeORM raw query 返回类型） */
type Row = Record<string, unknown>;

/** 从 raw query 结果行安全提取数值 */
const getNum = (row: Row | undefined, key: string, fallback = '0'): number => {
  const val = row?.[key];
  const str =
    typeof val === 'string' || typeof val === 'number' ? String(val) : fallback;
  return parseFloat(str);
};

/** 从 raw query 结果行安全提取整数 */
const getInt = (row: Row | undefined, key: string, fallback = '0'): number => {
  const val = row?.[key];
  const str =
    typeof val === 'string' || typeof val === 'number' ? String(val) : fallback;
  return parseInt(str);
};

/**
 * 驾驶舱服务
 * 聚合所有业务模块数据，提供 KPI 统计、趋势分析、排行榜、待办事项
 * 所有 SQL 使用参数化查询防止注入
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly rateService: RateService,
    private readonly systemConfigService: SystemConfigService,
    @InjectRepository(Salesperson)
    private readonly salespersonRepo: Repository<Salesperson>,
  ) {}

  /**
   * 检查用户是否拥有指定全局查看权限
   * @param userId 用户 ID
   * @param permissionCode 权限码，默认 'dashboard:view-all'
   * SUPER_ADMIN 兜底放行
   */
  async canViewAll(userId: string, permissionCode = 'dashboard:view-all'): Promise<boolean> {
    if (!userId) return false;
    const rows = await this.dataSource.query(
      `SELECT 1 FROM sys_user_role ur
       INNER JOIN sys_role r ON ur.role_id = r.id AND r.status = 1
       INNER JOIN sys_role_menu rm ON r.id = rm.role_id
       INNER JOIN sys_menu m ON rm.menu_id = m.id AND m.status = 1
       WHERE ur.user_id = ? AND (m.permission = ? OR r.role_code = 'SUPER_ADMIN')
       LIMIT 1`,
      [userId, permissionCode],
    );
    return rows.length > 0;
  }

  /**
   * 根据系统用户 ID 和视图模式解析实际的销售员过滤 ID
   * @param userId 系统用户 ID
   * @param viewMode 视图模式 'global' | 'personal' | undefined
   * @param permissionCode 判断全局查看权限码，默认 'dashboard:view-all'
   * @returns salespersonId（需要过滤时）或 null（不过滤）
   */
  async resolveSalespersonId(userId: string, viewMode?: string, permissionCode = 'dashboard:view-all'): Promise<string | null> {
    if (!userId) return null;

    const hasGlobalPerm = await this.canViewAll(userId, permissionCode);

    if (viewMode === 'personal') {
      // 明确请求个人视图 → 查销售员关联
      const sp = await this.salespersonRepo.findOne({ where: { userId, status: 1 } });
      // 无关联销售员时返回哨兵值，调用方据此返回空数据（而非退化为全局）
      return sp?.id ?? '__NONE__';
    }

    if (viewMode === 'global' && hasGlobalPerm) {
      // 明确请求全局且有权限 → 不过滤
      return null;
    }

    // viewMode 未传：有全局权限则默认全局，否则默认个人
    if (hasGlobalPerm) return null;

    const sp = await this.salespersonRepo.findOne({ where: { userId, status: 1 } });
    return sp?.id ?? null;
  }

  /**
   * KPI 总览
   * viewMode='global'：全局数据（需 dashboard:view-all 权限）
   * viewMode='personal'：按销售员过滤
   * viewMode 未传：有权限默认全局，无权限默认个人
   */
  async getOverview(startDate?: string, endDate?: string, userId?: string, viewMode?: string) {
    // 解析视图模式 → 得到实际的销售员过滤 ID
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;
    const canViewAllFlag = userId ? await this.canViewAll(userId) : false;

    // 哨兵值：个人视图但无关联销售员 → 返回全空数据
    if (salespersonId === '__NONE__') {
      return {
        canViewAll: canViewAllFlag,
        currentView: 'personal' as const,
        totalSalesUsd: '0.00', totalSalesCny: '0.00',
        totalPaymentUsd: '0.00', totalPaymentCny: '0.00',
        totalProfitUsd: '0.00', totalProfitCny: '0.00',
        profitRate: '0.00',
        orderCount: 0, shipmentCount: 0,
        totalOrderCount: 0, status1Count: 0, status2Count: 0,
        totalPurchaseUsd: '0.00', totalPurchaseCny: '0.00',
        inventoryValueUsd: '0.00', inventoryValueCny: '0.00',
        commissionEarned: '0.00', commissionClawback: '0.00',
        commissionNet: '0.00', commissionPending: '0.00',
        commissionEarnedUsd: '0.00', commissionClawbackUsd: '0.00',
        commissionNetUsd: '0.00', commissionPendingUsd: '0.00',
      };
    }

    const currentView: 'global' | 'personal' = salespersonId ? 'personal' : 'global';
    // 是否处于个人视图（用于跳过不适用的查询）
    const isPersonalView = !!salespersonId;
    // 销售员过滤参数（传给需要过滤的查询）
    const spFilter = salespersonId
      ? { alias: 'so', salespersonId }
      : undefined;

    // 个人视图不适用的查询直接返回空结果
    const emptyRow = (): Row[] => [{ totalPurchaseUsd: '0', totalPurchaseCny: '0', inventoryValueUsd: '0', inventoryValueCny: '0' }];

    // 所有独立查询并行执行
    const [
      orderStats,
      paymentStats,
      profitStats,
      shipmentStats,
      pipelineStats,
      purchaseStats,
      inventoryStats,
      commissionStats,
    ] = await Promise.all([
      // 销售额：仅已完成订单
      this.executeQuery(
        `SELECT COALESCE(SUM(total_amount_usd), 0) AS totalSalesUsd,
                COALESCE(SUM(total_amount_cny), 0) AS totalSalesCny,
                COUNT(*) AS orderCount
           FROM sales_order so WHERE so.status = 2 {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
        [],
        spFilter,
      ),
      // 收款额：仅已完成订单的收款记录
      this.executeQuery(
        `SELECT COALESCE(SUM(p.amount_usd), 0) AS totalPaymentUsd,
                COALESCE(SUM(p.amount_cny), 0) AS totalPaymentCny
           FROM payment p INNER JOIN sales_order so ON p.order_id = so.id
           WHERE p.type = 1 AND so.status = 2 {dateFilter}`,
        'p.payment_date',
        startDate,
        endDate,
        [],
        spFilter,
      ),
      // 利润：订单级统一公式（= 订单金额 − 博主佣金 − 已退款 − 直接退款 − 产品成本 − 额外成本），仅已完成订单
      this.executeQuery(
        `SELECT
           COALESCE(SUM(
             so.total_amount_cny
             - so.total_amount_cny * COALESCE(so.blogger_commission_rate, 0) / 100
             - COALESCE(so.refunded_amount_cny, 0)
             - COALESCE(so.standalone_refunded_amount_cny, 0)
             - COALESCE(pc.cost_cny, 0)
             - COALESCE(ec.cost_cny, 0)
           ), 0) AS totalProfitCny,
           COALESCE(SUM(
             CASE WHEN so.exchange_rate > 0 THEN (
               so.total_amount_cny
               - so.total_amount_cny * COALESCE(so.blogger_commission_rate, 0) / 100
               - COALESCE(so.refunded_amount_cny, 0)
               - COALESCE(so.standalone_refunded_amount_cny, 0)
               - COALESCE(pc.cost_cny, 0)
               - COALESCE(ec.cost_cny, 0)
             ) / so.exchange_rate ELSE 0 END
           ), 0) AS totalProfitUsd
         FROM sales_order so
         LEFT JOIN (
           SELECT s.order_id, SUM(si.total_cost_cny) AS cost_cny, SUM(si.total_cost_usd) AS cost_usd
           FROM shipment_item si INNER JOIN shipment s ON si.shipment_id = s.id
           GROUP BY s.order_id
         ) pc ON so.id = pc.order_id
         LEFT JOIN (
           SELECT order_id, SUM(amount_cny) AS cost_cny, SUM(amount_usd) AS cost_usd
           FROM sales_order_cost GROUP BY order_id
         ) ec ON so.id = ec.order_id
         WHERE so.status = 2 {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
        [],
        spFilter,
      ),
      // 发货数：仅已完成订单
      this.executeQuery(
        `SELECT COUNT(*) AS shipmentCount
           FROM shipment s INNER JOIN sales_order so ON s.order_id = so.id
           WHERE so.status = 2 {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
        [],
        spFilter,
      ),
      // 订单状态分布（非取消订单）：总数 + 各状态数量
      this.executeQuery(
        `SELECT COUNT(*) AS totalOrderCount,
                SUM(CASE WHEN so.status = 1 THEN 1 ELSE 0 END) AS status1Count,
                SUM(CASE WHEN so.status = 2 THEN 1 ELSE 0 END) AS status2Count
           FROM sales_order so WHERE so.status IN (1, 2) {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
        [],
        spFilter,
      ),
      // 采购数据：个人视图不适用，直接跳过
      isPersonalView
        ? emptyRow()
        : this.executeQuery(
            `SELECT COALESCE(SUM(po.total_amount_usd), 0) AS totalPurchaseUsd,
                    COALESCE(SUM(po.total_amount_cny), 0) AS totalPurchaseCny
               FROM purchase_order po WHERE po.status IN (1, 2) {dateFilter}`,
            'po.purchase_date',
            startDate,
            endDate,
          ),
      // 库存数据：个人视图不适用，直接跳过
      isPersonalView
        ? emptyRow()
        : this.executeQuery(
            `SELECT COALESCE(SUM(CAST(ib.stock_quantity AS DECIMAL(18,4)) * CAST(ib.unit_cost_usd AS DECIMAL(18,2))), 0) AS inventoryValueUsd,
                    COALESCE(SUM(CAST(ib.stock_quantity AS DECIMAL(18,4)) * CAST(ib.unit_cost_cny AS DECIMAL(18,2))), 0) AS inventoryValueCny
               FROM inventory_batch ib WHERE ib.status = 1`,
          ),
      this.getCommissionSummary(startDate, endDate, salespersonId),
    ]);

    const totalProfitCny = getNum(profitStats[0], 'totalProfitCny');
    const totalProfitUsd = getNum(profitStats[0], 'totalProfitUsd');

    const totalSalesCny = getNum(orderStats[0], 'totalSalesCny');
    const totalSalesUsd = getNum(orderStats[0], 'totalSalesUsd');
    const profitRate = totalSalesCny > 0 ? (totalProfitCny / totalSalesCny) * 100 : 0;

    return {
      canViewAll: canViewAllFlag,
      currentView,
      totalSalesUsd: totalSalesUsd.toFixed(2),
      totalSalesCny: totalSalesCny.toFixed(2),
      totalPaymentUsd: getNum(paymentStats[0], 'totalPaymentUsd').toFixed(2),
      totalPaymentCny: getNum(paymentStats[0], 'totalPaymentCny').toFixed(2),
      totalProfitUsd: totalProfitUsd.toFixed(2),
      totalProfitCny: totalProfitCny.toFixed(2),
      profitRate: profitRate.toFixed(2),
      orderCount: getInt(orderStats[0], 'orderCount'),
      shipmentCount: getInt(shipmentStats[0], 'shipmentCount'),
      totalOrderCount: getInt(pipelineStats[0], 'totalOrderCount'),
      status1Count: getInt(pipelineStats[0], 'status1Count'),
      status2Count: getInt(pipelineStats[0], 'status2Count'),
      totalPurchaseUsd: getNum(purchaseStats[0], 'totalPurchaseUsd').toFixed(2),
      totalPurchaseCny: getNum(purchaseStats[0], 'totalPurchaseCny').toFixed(2),
      inventoryValueUsd: getNum(inventoryStats[0], 'inventoryValueUsd').toFixed(2),
      inventoryValueCny: getNum(inventoryStats[0], 'inventoryValueCny').toFixed(2),
      commissionEarned: commissionStats.monthEarned.toFixed(2),
      commissionClawback: commissionStats.monthClawback.toFixed(2),
      commissionNet: commissionStats.monthNet,
      commissionPending: commissionStats.totalPending.toFixed(2),
      commissionEarnedUsd: commissionStats.monthEarnedUsd.toFixed(2),
      commissionClawbackUsd: commissionStats.monthClawbackUsd.toFixed(2),
      commissionNetUsd: commissionStats.monthNetUsd,
      commissionPendingUsd: commissionStats.totalPendingUsd.toFixed(2),
    };
  }

  /**
   * 提成汇总统计
   * @param salespersonId 销售员 ID（传入时仅统计该销售员）
   */
  async getCommissionSummary(startDate?: string, endDate?: string, salespersonId?: string | null) {
    const dateParams: unknown[] = [];
    let dateFilter = '';
    if (startDate && endDate) {
      dateFilter = 'AND created_time >= ? AND created_time <= ?';
      dateParams.push(startDate, endDate + ' 23:59:59');
    }
    const spParams: unknown[] = [];
    let spFilter = '';
    if (salespersonId) {
      spFilter = 'AND salesperson_id = ?';
      spParams.push(salespersonId);
    }

    const [earned, clawback, pending] = await Promise.all([
      this.dataSource.query(
        `SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
                COALESCE(SUM(commission_amount_usd), 0) AS totalUsd
         FROM commission_ledger WHERE type = 1 ${dateFilter} ${spFilter}`,
        [...dateParams, ...spParams],
      ),
      this.dataSource.query(
        `SELECT COALESCE(-SUM(commission_amount_cny), 0) AS total,
                COALESCE(-SUM(commission_amount_usd), 0) AS totalUsd
         FROM commission_ledger WHERE type = 2 ${dateFilter} ${spFilter}`,
        [...dateParams, ...spParams],
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(commission_amount_cny), 0) AS total,
                COALESCE(SUM(commission_amount_usd), 0) AS totalUsd
         FROM commission_ledger WHERE status = 1 ${spFilter}`,
        spParams,
      ),
    ]);

    const monthEarned = parseFloat(earned[0]?.total || '0');
    const monthEarnedUsd = parseFloat(earned[0]?.totalUsd || '0');
    const monthClawback = parseFloat(clawback[0]?.total || '0');
    const monthClawbackUsd = parseFloat(clawback[0]?.totalUsd || '0');

    return {
      monthEarned,
      monthEarnedUsd,
      monthClawback,
      monthClawbackUsd,
      monthNet: (monthEarned - monthClawback).toFixed(2),
      monthNetUsd: (monthEarnedUsd - monthClawbackUsd).toFixed(2),
      totalPending: parseFloat(pending[0]?.total || '0'),
      totalPendingUsd: parseFloat(pending[0]?.totalUsd || '0'),
    };
  }

  /**
   * 销售趋势
   */
  async getSalesTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
    userId?: string,
    viewMode?: string,
  ) {
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;
    if (salespersonId === '__NONE__') return [];
    const dateFormat = this.getDateFormat(granularity);
    return this.executeQuery(
      `SELECT DATE_FORMAT(so.order_date, '${dateFormat}') AS period,
              COALESCE(SUM(so.total_amount_cny), 0) AS amountCny,
              COALESCE(SUM(so.total_amount_usd), 0) AS amountUsd,
              COUNT(*) AS count
       FROM sales_order so WHERE so.status IN (1, 2) {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'so.order_date',
      startDate,
      endDate,
      [],
      salespersonId ? { alias: 'so', salespersonId } : undefined,
    );
  }

  /**
   * 利润趋势
   */
  async getProfitTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
    userId?: string,
    viewMode?: string,
  ) {
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;
    if (salespersonId === '__NONE__') return [];
    const dateFormat = this.getDateFormat(granularity);
    return this.executeQuery(
      `SELECT DATE_FORMAT(order_date, '${dateFormat}') AS period,
              COALESCE(SUM(
                so.total_amount_cny
                - so.total_amount_cny * COALESCE(so.blogger_commission_rate, 0) / 100
                - COALESCE(so.refunded_amount_cny, 0)
                - COALESCE(so.standalone_refunded_amount_cny, 0)
                - COALESCE(pc.cost_cny, 0)
                - COALESCE(ec.cost_cny, 0)
              ), 0) AS profitCny,
              COALESCE(SUM(
                CASE WHEN so.exchange_rate > 0 THEN (
                  so.total_amount_cny
                  - so.total_amount_cny * COALESCE(so.blogger_commission_rate, 0) / 100
                  - COALESCE(so.refunded_amount_cny, 0)
                  - COALESCE(so.standalone_refunded_amount_cny, 0)
                  - COALESCE(pc.cost_cny, 0)
                  - COALESCE(ec.cost_cny, 0)
                ) / so.exchange_rate ELSE 0 END
              ), 0) AS profitUsd
       FROM sales_order so
       LEFT JOIN (
         SELECT s.order_id, SUM(si.total_cost_cny) AS cost_cny, SUM(si.total_cost_usd) AS cost_usd
         FROM shipment_item si INNER JOIN shipment s ON si.shipment_id = s.id
         GROUP BY s.order_id
       ) pc ON so.id = pc.order_id
       LEFT JOIN (
         SELECT order_id, SUM(amount_cny) AS cost_cny, SUM(amount_usd) AS cost_usd
         FROM sales_order_cost GROUP BY order_id
       ) ec ON so.id = ec.order_id
       WHERE so.status = 2 {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'so.order_date',
      startDate,
      endDate,
      [],
      salespersonId ? { alias: 'so', salespersonId } : undefined,
    );
  }

  /**
   * 收款趋势
   * 销售员视角需要 JOIN sales_order 以按 salesperson_id 过滤
   */
  async getPaymentTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
    userId?: string,
    viewMode?: string,
  ) {
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;
    if (salespersonId === '__NONE__') return [];
    const dateFormat = this.getDateFormat(granularity);
    if (salespersonId) {
      // 销售员：需要 JOIN sales_order 过滤
      return this.executeQuery(
        `SELECT DATE_FORMAT(p.payment_date, '${dateFormat}') AS period,
                COALESCE(SUM(p.amount_cny), 0) AS amountCny,
                COALESCE(SUM(p.amount_usd), 0) AS amountUsd,
                COUNT(*) AS count
         FROM payment p
         INNER JOIN sales_order so ON p.order_id = so.id
         WHERE p.type = 1 {dateFilter}
         GROUP BY period ORDER BY period ASC`,
        'p.payment_date',
        startDate,
        endDate,
        [],
        { alias: 'so', salespersonId },
      );
    }
    return this.executeQuery(
      `SELECT DATE_FORMAT(p.payment_date, '${dateFormat}') AS period,
              COALESCE(SUM(p.amount_cny), 0) AS amountCny,
              COALESCE(SUM(p.amount_usd), 0) AS amountUsd,
              COUNT(*) AS count
       FROM payment p WHERE p.type = 1 {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'p.payment_date',
      startDate,
      endDate,
    );
  }

  /**
   * 采购趋势
   * 检查用户是否有 purchase-order:query 权限，有则返回数据，无则返回空数组
   */
  async getPurchaseTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
    userId?: string,
    viewMode?: string,
  ) {
    const hasPermission = userId ? await this.canViewAll(userId, 'purchase-order:query') : false;

    if (!hasPermission) return [];
    const dateFormat = this.getDateFormat(granularity);
    return this.executeQuery(
      `SELECT DATE_FORMAT(po.purchase_date, '${dateFormat}') AS period,
              COALESCE(SUM(po.total_amount_cny), 0) AS amountCny,
              COALESCE(SUM(po.total_amount_usd), 0) AS amountUsd,
              COUNT(*) AS count
       FROM purchase_order po WHERE po.status IN (1, 2, 3) {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'po.purchase_date',
      startDate,
      endDate,
    );
  }

  /**
   * 销售员排行榜
   * 销售员视角：只返回自己的数据
   */
  async getSalespersonRanking(
    startDate?: string,
    endDate?: string,
    limit = 10,
    userId?: string,
    viewMode?: string,
  ) {
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;
    if (salespersonId === '__NONE__') return [];
    const safeLimit = Math.max(1, Math.min(limit || 10, 100));
    if (salespersonId) {
      // 销售员只看自己
      return this.executeQuery(
        `SELECT sp.id AS salespersonId, sp.name AS salespersonName,
                COALESCE(SUM(so.total_amount_usd), 0) AS totalSalesUsd,
                COALESCE(SUM(so.total_amount_cny), 0) AS totalSalesCny,
                COUNT(so.id) AS orderCount
         FROM salesperson sp
         LEFT JOIN sales_order so ON sp.id = so.salesperson_id AND so.status IN (1, 2) {dateFilter}
         WHERE sp.id = ?
         GROUP BY sp.id, sp.name`,
        'so.order_date',
        startDate,
        endDate,
        [salespersonId],
      );
    }
    return this.executeQuery(
      `SELECT sp.id AS salespersonId, sp.name AS salespersonName,
              COALESCE(SUM(so.total_amount_usd), 0) AS totalSalesUsd,
              COALESCE(SUM(so.total_amount_cny), 0) AS totalSalesCny,
              COUNT(so.id) AS orderCount
       FROM salesperson sp
       LEFT JOIN sales_order so ON sp.id = so.salesperson_id AND so.status IN (1, 2) {dateFilter}
       GROUP BY sp.id, sp.name ORDER BY totalSalesCny DESC LIMIT ?`,
      'so.order_date',
      startDate,
      endDate,
      [safeLimit],
    );
  }

  /**
   * 商品排行榜
   * @param groupBy 'product'（按商品聚合，含型号明细）| 'model'（按商品+型号展开）
   */
  async getProductRanking(
    startDate?: string,
    endDate?: string,
    limit = 10,
    userId?: string,
    viewMode?: string,
    groupBy = 'product',
  ) {
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;
    if (salespersonId === '__NONE__') return [];
    const safeLimit = Math.max(1, Math.min(limit || 10, 100));
    const spFilter = salespersonId ? { alias: 'so', salespersonId } : undefined;

    if (groupBy === 'model') {
      // 按商品 + 型号维度展开
      return this.executeQuery(
        `SELECT oi.product_id AS productId,
                p.product_name AS productName,
                oi.product_model_id AS productModelId,
                COALESCE(pm.model_name, '—') AS modelName,
                COALESCE(SUM(CAST(oi.quantity AS DECIMAL(18,4))), 0) AS totalQuantity,
                COALESCE(SUM(oi.amount_usd), 0) AS totalSalesUsd,
                COALESCE(SUM(oi.amount_cny), 0) AS totalSalesCny
         FROM sales_order_item oi
         INNER JOIN sales_order so ON oi.order_id = so.id
         LEFT JOIN product p ON oi.product_id = p.id
         LEFT JOIN product_model pm ON oi.product_model_id = pm.id
         WHERE so.status IN (1, 2) {dateFilter}
         GROUP BY oi.product_id, p.product_name, oi.product_model_id, pm.model_name
         ORDER BY totalSalesCny DESC LIMIT ?`,
        'so.order_date',
        startDate,
        endDate,
        [safeLimit],
        spFilter,
      );
    }

    // 按商品维度聚合
    const products = await this.executeQuery(
      `SELECT oi.product_id AS productId,
              p.product_name AS productName,
              COALESCE(SUM(CAST(oi.quantity AS DECIMAL(18,4))), 0) AS totalQuantity,
              COALESCE(SUM(oi.amount_usd), 0) AS totalSalesUsd,
              COALESCE(SUM(oi.amount_cny), 0) AS totalSalesCny
       FROM sales_order_item oi
       INNER JOIN sales_order so ON oi.order_id = so.id
       LEFT JOIN product p ON oi.product_id = p.id
       WHERE so.status IN (1, 2) {dateFilter}
       GROUP BY oi.product_id, p.product_name
       ORDER BY totalSalesCny DESC LIMIT ?`,
      'so.order_date',
      startDate,
      endDate,
      [safeLimit],
      spFilter,
    );

    // 查询 Top N 商品的型号明细（用于悬停展示）
    if (products.length > 0) {
      const productIds = products.map((p: Row) => p.productId);
      const placeholders = productIds.map(() => '?').join(',');
      const dateParams: unknown[] = [];
      let dateClause = '';
      if (startDate) { dateClause += ' AND so.order_date >= ?'; dateParams.push(startDate); }
      if (endDate) { dateClause += ' AND so.order_date <= ?'; dateParams.push(endDate + ' 23:59:59'); }
      const spParams: unknown[] = salespersonId ? [salespersonId] : [];
      const spClause = salespersonId ? ' AND so.salesperson_id = ?' : '';

      const modelRows = await this.dataSource.query(
        `SELECT oi.product_id AS productId,
                oi.product_model_id AS productModelId,
                COALESCE(pm.model_name, '—') AS modelName,
                COALESCE(SUM(CAST(oi.quantity AS DECIMAL(18,4))), 0) AS quantity,
                COALESCE(SUM(oi.amount_usd), 0) AS amountUsd,
                COALESCE(SUM(oi.amount_cny), 0) AS amountCny
         FROM sales_order_item oi
         INNER JOIN sales_order so ON oi.order_id = so.id
         LEFT JOIN product_model pm ON oi.product_model_id = pm.id
         WHERE oi.product_id IN (${placeholders}) AND so.status IN (1, 2)${dateClause}${spClause}
         GROUP BY oi.product_id, oi.product_model_id, pm.model_name`,
        [...productIds, ...dateParams, ...spParams],
      );

      const modelMap = new Map<string, Array<Record<string, unknown>>>();
      for (const m of modelRows) {
        const key = String(m.productId);
        if (!modelMap.has(key)) modelMap.set(key, []);
        modelMap.get(key)!.push(m);
      }

      for (const p of products) {
        (p as any).models = modelMap.get(String(p.productId)) || [];
      }
    }

    return products;
  }

  /**
   * 待处理事项
   * 销售员视角：只显示自己的待发货/待收款，隐藏采购和库存
   */
  async getPendingItems(userId?: string, viewMode?: string) {
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;
    if (salespersonId === '__NONE__') {
      return { pendingShipment: 0, pendingPayment: 0, pendingReceipt: 0, inventoryWarnings: 0 };
    }
    type CountResult = Array<{ count: string }>;
    const spParams: unknown[] = salespersonId ? [salespersonId] : [];
    const spFilter = salespersonId ? 'AND salesperson_id = ?' : '';

    // 库存预警采用混合阈值：型号 minimum_stock 非 NULL 时优先使用（0=库存为0时预警，负数=不预警），
    // 为 NULL 时回退到全局 LOW_STOCK_WARNING
    const lowStockRaw = await this.systemConfigService.getByKey('LOW_STOCK_WARNING');
    const lowStock = parseFloat(lowStockRaw || '0') || 0;
    const effectiveThreshold = `CASE WHEN pm.id IS NOT NULL AND pm.minimum_stock IS NOT NULL THEN CAST(pm.minimum_stock AS DECIMAL(18,4)) ELSE ? END`;

    const [pendingShipment, pendingPayment, pendingReceipt, inventoryWarnings] =
      (await Promise.all([
        this.dataSource.query(
          `SELECT COUNT(*) AS count FROM sales_order WHERE status = 1 AND shipment_status IN (1, 2) ${spFilter}`,
          spParams,
        ),
        this.dataSource.query(
          `SELECT COUNT(*) AS count FROM sales_order WHERE status = 1 AND payment_status IN (1, 2) ${spFilter}`,
          spParams,
        ),
        salespersonId
          ? Promise.resolve([{ count: '0' }])
          : this.dataSource.query(
              `SELECT COUNT(*) AS count FROM purchase_order WHERE status IN (1, 2)`,
            ),
        salespersonId
          ? Promise.resolve([{ count: '0' }])
          : this.dataSource.query(
              `SELECT COUNT(*) AS count
             FROM inventory inv
             INNER JOIN product p ON p.id = inv.product_id
             LEFT JOIN product_model pm ON pm.id = inv.product_model_id AND pm.is_deleted = 0
             WHERE p.status = 1
               AND (inv.product_model_id IS NULL OR (pm.id IS NOT NULL AND pm.status = 1))
               AND CAST(inv.available_quantity AS DECIMAL(18,4)) <= ${effectiveThreshold}`,
              [lowStock],
            ),
      ])) as [CountResult, CountResult, CountResult, CountResult];

    return {
      pendingShipment: parseInt(pendingShipment[0]?.count || '0'),
      pendingPayment: parseInt(pendingPayment[0]?.count || '0'),
      pendingReceipt: parseInt(pendingReceipt[0]?.count || '0'),
      inventoryWarnings: parseInt(inventoryWarnings[0]?.count || '0'),
    };
  }

  /**
   * 进行中订单 KPI
   * 展示 status=1 的订单核心指标：数量、金额、收发货状态分布、预估利润
   */
  async getInProgressKpi(userId?: string, viewMode?: string) {
    const salespersonId = userId ? await this.resolveSalespersonId(userId, viewMode) : null;

    if (salespersonId === '__NONE__') {
      return {
        orderCount: 0,
        totalAmountUsd: '0.00', totalAmountCny: '0.00',
        receivedAmountUsd: '0.00', receivedAmountCny: '0.00',
        unreceivedAmountUsd: '0.00', unreceivedAmountCny: '0.00',
        shipmentDistribution: [
          { status: 1, label: '待发货', count: 0, amountCny: '0.00', amountUsd: '0.00' },
          { status: 2, label: '部分发货', count: 0, amountCny: '0.00', amountUsd: '0.00' },
          { status: 3, label: '全部发货', count: 0, amountCny: '0.00', amountUsd: '0.00' },
        ],
        paymentDistribution: [
          { status: 1, label: '未收款', count: 0, amountCny: '0.00', amountUsd: '0.00' },
          { status: 2, label: '部分收款', count: 0, amountCny: '0.00', amountUsd: '0.00' },
          { status: 3, label: '已收齐', count: 0, amountCny: '0.00', amountUsd: '0.00' },
        ],
        estimatedProfitUsd: '0.00', estimatedProfitCny: '0.00',
      };
    }

    const spFilter = salespersonId
      ? { alias: 'so', salespersonId }
      : undefined;

    const [summary, shipmentDist, paymentDist, profitRows] = await Promise.all([
      // 汇总：订单数、总金额、已收金额
      this.executeQuery(
        `SELECT COUNT(*) AS orderCount,
                COALESCE(SUM(so.total_amount_usd), 0) AS totalAmountUsd,
                COALESCE(SUM(so.total_amount_cny), 0) AS totalAmountCny,
                COALESCE(SUM(so.received_amount_usd), 0) AS receivedAmountUsd,
                COALESCE(SUM(so.received_amount_cny), 0) AS receivedAmountCny
           FROM sales_order so WHERE so.status = 1 {dateFilter}`,
        undefined, undefined, undefined, [], spFilter,
      ),
      // 发货状态分布
      this.executeQuery(
        `SELECT so.shipment_status AS shipmentStatus,
                COUNT(*) AS cnt,
                COALESCE(SUM(so.total_amount_cny), 0) AS amountCny,
                COALESCE(SUM(so.total_amount_usd), 0) AS amountUsd
           FROM sales_order so WHERE so.status = 1
           GROUP BY so.shipment_status {dateFilter}`,
        undefined, undefined, undefined, [], spFilter,
      ),
      // 收款状态分布
      this.executeQuery(
        `SELECT so.payment_status AS paymentStatus,
                COUNT(*) AS cnt,
                COALESCE(SUM(so.total_amount_cny), 0) AS amountCny,
                COALESCE(SUM(so.total_amount_usd), 0) AS amountUsd
           FROM sales_order so WHERE so.status = 1
           GROUP BY so.payment_status {dateFilter}`,
        undefined, undefined, undefined, [], spFilter,
      ),
      // 预估利润（与已完成订单相同公式，但筛选 status=1）
      this.executeQuery(
        `SELECT
           COALESCE(SUM(
             so.total_amount_cny
             - so.total_amount_cny * COALESCE(so.blogger_commission_rate, 0) / 100
             - COALESCE(so.refunded_amount_cny, 0)
             - COALESCE(so.standalone_refunded_amount_cny, 0)
             - COALESCE(pc.cost_cny, 0)
             - COALESCE(ec.cost_cny, 0)
           ), 0) AS profitCny,
           COALESCE(SUM(
             CASE WHEN so.exchange_rate > 0 THEN (
               so.total_amount_cny
               - so.total_amount_cny * COALESCE(so.blogger_commission_rate, 0) / 100
               - COALESCE(so.refunded_amount_cny, 0)
               - COALESCE(so.standalone_refunded_amount_cny, 0)
               - COALESCE(pc.cost_cny, 0)
               - COALESCE(ec.cost_cny, 0)
             ) / so.exchange_rate ELSE 0 END
           ), 0) AS profitUsd
         FROM sales_order so
         LEFT JOIN (
           SELECT s.order_id, SUM(si.total_cost_cny) AS cost_cny
           FROM shipment_item si INNER JOIN shipment s ON si.shipment_id = s.id
           GROUP BY s.order_id
         ) pc ON so.id = pc.order_id
         LEFT JOIN (
           SELECT order_id, SUM(amount_cny) AS cost_cny
           FROM sales_order_cost GROUP BY order_id
         ) ec ON so.id = ec.order_id
         WHERE so.status = 1 {dateFilter}`,
        undefined, undefined, undefined, [], spFilter,
      ),
    ]);

    const row = summary[0];
    const totalAmountUsd = getNum(row, 'totalAmountUsd');
    const totalAmountCny = getNum(row, 'totalAmountCny');
    const receivedAmountUsd = getNum(row, 'receivedAmountUsd');
    const receivedAmountCny = getNum(row, 'receivedAmountCny');

    // 发货状态分布映射
    const shipmentLabels: Record<number, string> = { 1: '待发货', 2: '部分发货', 3: '全部发货' };
    const shipmentDistribution = [1, 2, 3].map((s) => {
      const found = shipmentDist.find((r) => getInt(r, 'shipmentStatus') === s);
      return {
        status: s,
        label: shipmentLabels[s],
        count: getInt(found, 'cnt'),
        amountCny: getNum(found, 'amountCny').toFixed(2),
        amountUsd: getNum(found, 'amountUsd').toFixed(2),
      };
    });

    // 收款状态分布映射
    const paymentLabels: Record<number, string> = { 1: '未收款', 2: '部分收款', 3: '已收齐' };
    const paymentDistribution = [1, 2, 3].map((s) => {
      const found = paymentDist.find((r) => getInt(r, 'paymentStatus') === s);
      return {
        status: s,
        label: paymentLabels[s],
        count: getInt(found, 'cnt'),
        amountCny: getNum(found, 'amountCny').toFixed(2),
        amountUsd: getNum(found, 'amountUsd').toFixed(2),
      };
    });

    // 预估利润（CNY 为本币，USD 已在 SQL 中按逐单 CNY÷订单汇率派生，与 getOverview 口径一致）
    const profitCny = getNum(profitRows[0], 'profitCny');
    const profitUsd = getNum(profitRows[0], 'profitUsd');

    return {
      orderCount: getInt(row, 'orderCount'),
      totalAmountUsd: totalAmountUsd.toFixed(2),
      totalAmountCny: totalAmountCny.toFixed(2),
      receivedAmountUsd: receivedAmountUsd.toFixed(2),
      receivedAmountCny: receivedAmountCny.toFixed(2),
      unreceivedAmountUsd: (totalAmountUsd - receivedAmountUsd).toFixed(2),
      unreceivedAmountCny: (totalAmountCny - receivedAmountCny).toFixed(2),
      shipmentDistribution,
      paymentDistribution,
      estimatedProfitUsd: profitUsd.toFixed(2),
      estimatedProfitCny: profitCny.toFixed(2),
    };
  }

  /**
   * 安全执行参数化查询
   * @param template SQL 模板，用 {dateFilter} 占位日期过滤条件
   * @param column 日期字段名
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param extraParams 额外的参数化值
   * @param salespersonFilter 销售员过滤（alias 为表别名，salespersonId 为销售员 ID）
   */
  private async executeQuery(
    template: string,
    column?: string,
    startDate?: string,
    endDate?: string,
    extraParams: unknown[] = [],
    salespersonFilter?: { alias: string; salespersonId: string },
  ): Promise<Row[]> {
    const params: unknown[] = [];
    let dateFilter = '';

    if (column) {
      if (startDate) {
        dateFilter += ` AND ${column} >= ?`;
        params.push(startDate);
      }
      if (endDate) {
        dateFilter += ` AND ${column} <= ?`;
        params.push(endDate);
      }
    }

    // 销售员身份过滤
    if (salespersonFilter) {
      dateFilter += ` AND ${salespersonFilter.alias}.salesperson_id = ?`;
      params.push(salespersonFilter.salespersonId);
    }

    const sql = template.replace('{dateFilter}', dateFilter);
    const allParams = [...params, ...extraParams];

    return this.dataSource.query(sql, allParams);
  }

  /** 获取日期格式化字符串（仅允许白名单值，防注入） */
  private getDateFormat(granularity: string): string {
    switch (granularity) {
      case 'month':
        return '%Y-%m';
      case 'week':
        return '%x-W%v';
      default:
        return '%Y-%m-%d';
    }
  }
}
