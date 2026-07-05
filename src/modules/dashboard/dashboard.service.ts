import { Injectable, Logger } from '@nestjs/common'
import { DataSource } from 'typeorm'

/**
 * 驾驶舱服务
 * 聚合所有业务模块数据，提供 KPI 统计、趋势分析、排行榜、待办事项
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name)

  constructor(private readonly dataSource: DataSource) {}

  /**
   * KPI 总览（8 个指标卡）
   */
  async getOverview(startDate?: string, endDate?: string) {
    const dateFilter = this.buildDateFilter('so.order_date', startDate, endDate)

    // 销售额 + 订单数
    const orderStats = await this.dataSource.query(`
      SELECT
        COALESCE(SUM(total_amount_usd), 0) AS totalSales,
        COUNT(*) AS orderCount
      FROM sales_order so
      WHERE so.status >= 1 ${dateFilter}
    `)

    // 收款额
    const paymentStats = await this.dataSource.query(`
      SELECT COALESCE(SUM(usd_amount), 0) AS totalPayment
      FROM payment p
      INNER JOIN sales_order so ON p.order_id = so.id
      WHERE 1=1 ${this.buildDateFilter('p.payment_date', startDate, endDate)}
    `)

    // 利润（发货毛利 - 订单额外成本）
    const profitStats = await this.dataSource.query(`
      SELECT
        COALESCE(SUM(si.gross_profit), 0) AS shipmentProfit
      FROM shipment_item si
      INNER JOIN shipment s ON si.shipment_id = s.id
      INNER JOIN sales_order so ON s.order_id = so.id
      WHERE 1=1 ${dateFilter}
    `)

    const costStats = await this.dataSource.query(`
      SELECT COALESCE(SUM(soc.amount), 0) AS totalCost
      FROM sales_order_cost soc
      INNER JOIN sales_order so ON soc.order_id = so.id
      WHERE 1=1 ${dateFilter}
    `)

    const shipmentProfit = parseFloat(profitStats[0]?.shipmentProfit || '0')
    const orderCost = parseFloat(costStats[0]?.totalCost || '0')
    const totalProfit = shipmentProfit - orderCost

    // 发货数
    const shipmentStats = await this.dataSource.query(`
      SELECT COUNT(*) AS shipmentCount
      FROM shipment s
      INNER JOIN sales_order so ON s.order_id = so.id
      WHERE 1=1 ${dateFilter}
    `)

    // 采购额
    const purchaseStats = await this.dataSource.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS totalPurchase
      FROM purchase_order po
      WHERE po.status >= 1
      ${this.buildDateFilter('po.purchase_date', startDate, endDate)}
    `)

    // 库存金额
    const inventoryStats = await this.dataSource.query(`
      SELECT COALESCE(SUM(CAST(ib.stock_quantity AS DECIMAL(18,4)) * CAST(ib.unit_cost AS DECIMAL(18,2))), 0) AS inventoryValue
      FROM inventory_batch ib
      WHERE ib.status = 1
    `)

    const totalSales = parseFloat(orderStats[0]?.totalSales || '0')
    const profit = totalProfit
    const profitRate = totalSales > 0 ? (profit / totalSales * 100) : 0

    return {
      totalSales: totalSales.toFixed(2),
      totalPayment: parseFloat(paymentStats[0]?.totalPayment || '0').toFixed(2),
      totalProfit: profit.toFixed(2),
      profitRate: profitRate.toFixed(2),
      orderCount: parseInt(orderStats[0]?.orderCount || '0'),
      shipmentCount: parseInt(shipmentStats[0]?.shipmentCount || '0'),
      totalPurchase: parseFloat(purchaseStats[0]?.totalPurchase || '0').toFixed(2),
      inventoryValue: parseFloat(inventoryStats[0]?.inventoryValue || '0').toFixed(2),
    }
  }

  /**
   * 销售趋势
   */
  async getSalesTrend(startDate?: string, endDate?: string, granularity = 'day') {
    const dateFormat = this.getDateFormat(granularity)
    const dateFilter = this.buildDateFilter('so.order_date', startDate, endDate)

    return this.dataSource.query(`
      SELECT
        DATE_FORMAT(so.order_date, '${dateFormat}') AS period,
        COALESCE(SUM(so.total_amount_usd), 0) AS amount,
        COUNT(*) AS count
      FROM sales_order so
      WHERE so.status >= 1 ${dateFilter}
      GROUP BY period
      ORDER BY period ASC
    `)
  }

  /**
   * 利润趋势
   */
  async getProfitTrend(startDate?: string, endDate?: string, granularity = 'day') {
    const dateFormat = this.getDateFormat(granularity)
    const dateFilter = this.buildDateFilter('so.order_date', startDate, endDate)

    return this.dataSource.query(`
      SELECT
        DATE_FORMAT(so.order_date, '${dateFormat}') AS period,
        COALESCE(SUM(si.gross_profit), 0) AS profit
      FROM shipment_item si
      INNER JOIN shipment s ON si.shipment_id = s.id
      INNER JOIN sales_order so ON s.order_id = so.id
      WHERE 1=1 ${dateFilter}
      GROUP BY period
      ORDER BY period ASC
    `)
  }

  /**
   * 收款趋势
   */
  async getPaymentTrend(startDate?: string, endDate?: string, granularity = 'day') {
    const dateFormat = this.getDateFormat(granularity)
    const dateFilter = this.buildDateFilter('p.payment_date', startDate, endDate)

    return this.dataSource.query(`
      SELECT
        DATE_FORMAT(p.payment_date, '${dateFormat}') AS period,
        COALESCE(SUM(p.usd_amount), 0) AS amount,
        COUNT(*) AS count
      FROM payment p
      WHERE 1=1 ${dateFilter}
      GROUP BY period
      ORDER BY period ASC
    `)
  }

  /**
   * 采购趋势
   */
  async getPurchaseTrend(startDate?: string, endDate?: string, granularity = 'day') {
    const dateFormat = this.getDateFormat(granularity)
    const dateFilter = this.buildDateFilter('po.purchase_date', startDate, endDate)

    return this.dataSource.query(`
      SELECT
        DATE_FORMAT(po.purchase_date, '${dateFormat}') AS period,
        COALESCE(SUM(po.total_amount), 0) AS amount,
        COUNT(*) AS count
      FROM purchase_order po
      WHERE po.status >= 1 ${dateFilter}
      GROUP BY period
      ORDER BY period ASC
    `)
  }

  /**
   * 销售员排行榜
   */
  async getSalespersonRanking(startDate?: string, endDate?: string, limit = 10) {
    const dateFilter = this.buildDateFilter('so.order_date', startDate, endDate)

    return this.dataSource.query(`
      SELECT
        sp.id AS salespersonId,
        sp.name AS salespersonName,
        COALESCE(SUM(so.total_amount_usd), 0) AS totalSales,
        COUNT(so.id) AS orderCount
      FROM salesperson sp
      LEFT JOIN sales_order so ON sp.id = so.salesperson_id AND so.status >= 1 ${dateFilter}
      GROUP BY sp.id, sp.name
      ORDER BY totalSales DESC
      LIMIT ${limit}
    `)
  }

  /**
   * 商品排行榜
   */
  async getProductRanking(startDate?: string, endDate?: string, limit = 10) {
    const dateFilter = this.buildDateFilter('so.order_date', startDate, endDate)

    return this.dataSource.query(`
      SELECT
        oi.product_id AS productId,
        COALESCE(SUM(CAST(oi.quantity AS DECIMAL(18,4))), 0) AS totalQuantity,
        COALESCE(SUM(oi.amount_usd), 0) AS totalSales
      FROM sales_order_item oi
      INNER JOIN sales_order so ON oi.order_id = so.id
      WHERE so.status >= 1 ${dateFilter}
      GROUP BY oi.product_id
      ORDER BY totalSales DESC
      LIMIT ${limit}
    `)
  }

  /**
   * 待处理事项
   */
  async getPendingItems() {
    // 待发货订单
    const pendingShipment = await this.dataSource.query(`
      SELECT COUNT(*) AS count FROM sales_order
      WHERE status = 1 AND shipment_status IN (1, 2)
    `)

    // 待收款订单
    const pendingPayment = await this.dataSource.query(`
      SELECT COUNT(*) AS count FROM sales_order
      WHERE status = 1 AND payment_status IN (1, 2)
    `)

    // 待入库采购单
    const pendingReceipt = await this.dataSource.query(`
      SELECT COUNT(*) AS count FROM purchase_order
      WHERE status IN (1, 2)
    `)

    // 库存预警（可用库存 < 预警值）
    const inventoryWarnings = await this.dataSource.query(`
      SELECT COUNT(*) AS count FROM inventory
      WHERE CAST(available_quantity AS DECIMAL(18,4)) < CAST(minimum_stock AS DECIMAL(18,4))
    `)

    return {
      pendingShipment: parseInt(pendingShipment[0]?.count || '0'),
      pendingPayment: parseInt(pendingPayment[0]?.count || '0'),
      pendingReceipt: parseInt(pendingReceipt[0]?.count || '0'),
      inventoryWarnings: parseInt(inventoryWarnings[0]?.count || '0'),
    }
  }

  /** 构建日期过滤条件 */
  private buildDateFilter(column: string, startDate?: string, endDate?: string): string {
    let filter = ''
    if (startDate) filter += ` AND ${column} >= '${startDate}'`
    if (endDate) filter += ` AND ${column} <= '${endDate}'`
    return filter
  }

  /** 获取日期格式化字符串 */
  private getDateFormat(granularity: string): string {
    switch (granularity) {
      case 'month': return '%Y-%m'
      case 'week': return '%x-W%v'
      default: return '%Y-%m-%d'
    }
  }
}
