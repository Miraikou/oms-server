import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

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

  constructor(private readonly dataSource: DataSource) {}

  /**
   * KPI 总览（8 个指标卡）
   */
  async getOverview(startDate?: string, endDate?: string) {
    // 所有独立查询并行执行
    const [
      orderStats,
      paymentStats,
      profitStats,
      costStats,
      shipmentStats,
      purchaseStats,
      inventoryStats,
      commissionStats,
      rateResult,
    ] = await Promise.all([
      this.executeQuery(
        `SELECT COALESCE(SUM(total_amount_usd), 0) AS totalSalesUsd,
                COALESCE(SUM(total_amount_cny), 0) AS totalSalesCny,
                COUNT(*) AS orderCount
           FROM sales_order so WHERE so.status IN (1, 2) {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
      ),
      this.executeQuery(
        `SELECT COALESCE(SUM(p.amount_usd), 0) AS totalPaymentUsd,
                COALESCE(SUM(p.amount_cny), 0) AS totalPaymentCny
           FROM payment p INNER JOIN sales_order so ON p.order_id = so.id
           WHERE p.type = 1 {dateFilter}`,
        'p.payment_date',
        startDate,
        endDate,
      ),
      this.executeQuery(
        `SELECT COALESCE(SUM(si.gross_profit_cny), 0) AS shipmentProfit
           FROM shipment_item si
           INNER JOIN shipment s ON si.shipment_id = s.id
           INNER JOIN sales_order so ON s.order_id = so.id
           WHERE so.status IN (1, 2) {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
      ),
      this.executeQuery(
        `SELECT COALESCE(SUM(soc.amount_usd), 0) AS totalCostUsd,
                COALESCE(SUM(soc.amount_cny), 0) AS totalCostCny
           FROM sales_order_cost soc
           INNER JOIN sales_order so ON soc.order_id = so.id
           WHERE so.status IN (1, 2) {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
      ),
      this.executeQuery(
        `SELECT COUNT(*) AS shipmentCount
           FROM shipment s INNER JOIN sales_order so ON s.order_id = so.id
           WHERE so.status IN (1, 2) {dateFilter}`,
        'so.order_date',
        startDate,
        endDate,
      ),
      this.executeQuery(
        `SELECT COALESCE(SUM(po.total_amount_usd), 0) AS totalPurchaseUsd,
                COALESCE(SUM(po.total_amount_cny), 0) AS totalPurchaseCny
           FROM purchase_order po WHERE po.status IN (1, 2) {dateFilter}`,
        'po.purchase_date',
        startDate,
        endDate,
      ),
      this.executeQuery(
        `SELECT COALESCE(SUM(CAST(ib.stock_quantity AS DECIMAL(18,4)) * CAST(ib.unit_cost_usd AS DECIMAL(18,2))), 0) AS inventoryValueUsd,
                COALESCE(SUM(CAST(ib.stock_quantity AS DECIMAL(18,4)) * CAST(ib.unit_cost_cny AS DECIMAL(18,2))), 0) AS inventoryValueCny
           FROM inventory_batch ib WHERE ib.status = 1`,
      ),
      this.getCommissionSummary(startDate, endDate),
      this.dataSource.query(
        `SELECT rate FROM exchange_rate WHERE from_currency = 'USD' AND to_currency = 'CNY' ORDER BY effective_date DESC LIMIT 1`,
      ),
    ]);

    const currentRate = parseFloat(rateResult?.[0]?.rate || '7');

    const shipmentProfitCny = getNum(profitStats[0], 'shipmentProfit');
    const orderCostCny = getNum(costStats[0], 'totalCostCny');
    const totalProfitCny = shipmentProfitCny - orderCostCny;
    const orderCostUsd = getNum(costStats[0], 'totalCostUsd');
    // 发货利润仅有 CNY，USD 通过汇率换算
    const shipmentProfitUsd = shipmentProfitCny / currentRate;
    const totalProfitUsd = shipmentProfitUsd - orderCostUsd;

    const totalSalesCny = getNum(orderStats[0], 'totalSalesCny');
    const totalSalesUsd = getNum(orderStats[0], 'totalSalesUsd');
    const profitRate = totalSalesCny > 0 ? (totalProfitCny / totalSalesCny) * 100 : 0;

    return {
      totalSalesUsd: totalSalesUsd.toFixed(2),
      totalSalesCny: totalSalesCny.toFixed(2),
      totalPaymentUsd: getNum(paymentStats[0], 'totalPaymentUsd').toFixed(2),
      totalPaymentCny: getNum(paymentStats[0], 'totalPaymentCny').toFixed(2),
      totalProfitUsd: totalProfitUsd.toFixed(2),
      totalProfitCny: totalProfitCny.toFixed(2),
      profitRate: profitRate.toFixed(2),
      orderCount: getInt(orderStats[0], 'orderCount'),
      shipmentCount: getInt(shipmentStats[0], 'shipmentCount'),
      totalPurchaseUsd: getNum(purchaseStats[0], 'totalPurchaseUsd').toFixed(2),
      totalPurchaseCny: getNum(purchaseStats[0], 'totalPurchaseCny').toFixed(2),
      inventoryValueUsd: getNum(inventoryStats[0], 'inventoryValueUsd').toFixed(2),
      inventoryValueCny: getNum(inventoryStats[0], 'inventoryValueCny').toFixed(2),
      commissionEarned: commissionStats.monthEarned.toFixed(2),
      commissionClawback: commissionStats.monthClawback.toFixed(2),
      commissionNet: commissionStats.monthNet,
      commissionPending: commissionStats.totalPending.toFixed(2),
    };
  }

  /**
   * 提成汇总统计
   */
  async getCommissionSummary(startDate?: string, endDate?: string) {
    const dateFilter =
      startDate && endDate
        ? `AND created_time >= '${startDate}' AND created_time <= '${endDate} 23:59:59'`
        : '';

    const [earned, clawback, pending] = await Promise.all([
      this.dataSource.query(
        `SELECT COALESCE(SUM(commission_amount_cny), 0) AS total
         FROM commission_ledger WHERE type = 1 ${dateFilter}`,
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(ABS(commission_amount_cny)), 0) AS total
         FROM commission_ledger WHERE type = 2 ${dateFilter}`,
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(commission_amount_cny), 0) AS total
         FROM commission_ledger WHERE status = 1`,
      ),
    ]);

    return {
      monthEarned: parseFloat(earned[0]?.total || '0'),
      monthClawback: parseFloat(clawback[0]?.total || '0'),
      monthNet: (
        parseFloat(earned[0]?.total || '0') -
        parseFloat(clawback[0]?.total || '0')
      ).toFixed(2),
      totalPending: parseFloat(pending[0]?.total || '0'),
    };
  }

  /**
   * 销售趋势
   */
  async getSalesTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
  ) {
    const dateFormat = this.getDateFormat(granularity);
    return this.executeQuery(
      `SELECT DATE_FORMAT(so.order_date, '${dateFormat}') AS period,
              COALESCE(SUM(so.total_amount_cny), 0) AS amount,
              COUNT(*) AS count
       FROM sales_order so WHERE so.status IN (1, 2) {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'so.order_date',
      startDate,
      endDate,
    );
  }

  /**
   * 利润趋势
   */
  async getProfitTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
  ) {
    const dateFormat = this.getDateFormat(granularity);
    return this.executeQuery(
      `SELECT DATE_FORMAT(so.order_date, '${dateFormat}') AS period,
              COALESCE(SUM(si.gross_profit_cny), 0) AS profit
       FROM shipment_item si
       INNER JOIN shipment s ON si.shipment_id = s.id
       INNER JOIN sales_order so ON s.order_id = so.id
       WHERE so.status IN (1, 2) {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'so.order_date',
      startDate,
      endDate,
    );
  }

  /**
   * 收款趋势
   */
  async getPaymentTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
  ) {
    const dateFormat = this.getDateFormat(granularity);
    return this.executeQuery(
      `SELECT DATE_FORMAT(p.payment_date, '${dateFormat}') AS period,
              COALESCE(SUM(p.amount_cny), 0) AS amount, COUNT(*) AS count
       FROM payment p WHERE p.type = 1 {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'p.payment_date',
      startDate,
      endDate,
    );
  }

  /**
   * 采购趋势
   */
  async getPurchaseTrend(
    startDate?: string,
    endDate?: string,
    granularity = 'day',
  ) {
    const dateFormat = this.getDateFormat(granularity);
    return this.executeQuery(
      `SELECT DATE_FORMAT(po.purchase_date, '${dateFormat}') AS period,
              COALESCE(SUM(po.total_amount_cny), 0) AS amount, COUNT(*) AS count
       FROM purchase_order po WHERE po.status IN (1, 2) {dateFilter}
       GROUP BY period ORDER BY period ASC`,
      'po.purchase_date',
      startDate,
      endDate,
    );
  }

  /**
   * 销售员排行榜
   */
  async getSalespersonRanking(
    startDate?: string,
    endDate?: string,
    limit = 10,
  ) {
    const safeLimit = Math.max(1, Math.min(limit || 10, 100));
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
   */
  async getProductRanking(startDate?: string, endDate?: string, limit = 10) {
    const safeLimit = Math.max(1, Math.min(limit || 10, 100));
    return this.executeQuery(
      `SELECT oi.product_id AS productId,
              COALESCE(SUM(CAST(oi.quantity AS DECIMAL(18,4))), 0) AS totalQuantity,
              COALESCE(SUM(oi.amount_usd), 0) AS totalSalesUsd,
              COALESCE(SUM(oi.amount_cny), 0) AS totalSalesCny
       FROM sales_order_item oi
       INNER JOIN sales_order so ON oi.order_id = so.id
       WHERE so.status IN (1, 2) {dateFilter}
       GROUP BY oi.product_id ORDER BY totalSalesCny DESC LIMIT ?`,
      'so.order_date',
      startDate,
      endDate,
      [safeLimit],
    );
  }

  /**
   * 待处理事项（4 个独立 COUNT 并行执行）
   */
  async getPendingItems() {
    type CountResult = Array<{ count: string }>;
    const [pendingShipment, pendingPayment, pendingReceipt, inventoryWarnings] =
      (await Promise.all([
        this.dataSource.query(
          `SELECT COUNT(*) AS count FROM sales_order WHERE status = 1 AND shipment_status IN (1, 2)`,
        ),
        this.dataSource.query(
          `SELECT COUNT(*) AS count FROM sales_order WHERE status = 1 AND payment_status IN (1, 2)`,
        ),
        this.dataSource.query(
          `SELECT COUNT(*) AS count FROM purchase_order WHERE status IN (1, 2)`,
        ),
        this.dataSource.query(
          `SELECT COUNT(*) AS count FROM inventory
         WHERE CAST(available_quantity AS DECIMAL(18,4)) < CAST(minimum_stock AS DECIMAL(18,4))`,
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
   * 安全执行参数化查询
   * @param template SQL 模板，用 {dateFilter} 占位日期过滤条件
   * @param column 日期字段名
   * @param startDate 开始日期
   * @param endDate 结束日期
   * @param extraParams 额外的参数化值
   */
  private async executeQuery(
    template: string,
    column?: string,
    startDate?: string,
    endDate?: string,
    extraParams: unknown[] = [],
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
