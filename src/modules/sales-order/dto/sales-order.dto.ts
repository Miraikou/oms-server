/**
 * 订单管理 DTO
 * 包含创建、修改、查询订单及成本的数据传输对象
 */

/** 订单明细项 DTO */
export interface CreateSalesOrderItemDto {
  /** 商品 ID */
  productId: string;
  /** 订单数量 */
  quantity: string;
  /** 销售单价（订单币种） */
  unitPrice: string;
}

/** 创建订单 DTO */
export interface CreateSalesOrderDto {
  /** 销售员 ID */
  salespersonId: string;
  /** 客户名称 */
  customerName: string;
  /** 下单日期 */
  orderDate: string;
  /** 运输渠道 ID */
  transportChannelId: string;
  /** 交易方式 */
  tradeType: string;
  /** 订单币种（CNY/USD），默认 USD */
  currency?: string;
  /** 汇率（订单币种→CNY） */
  exchangeRate?: string;
  /** 博主佣金比例(%)，默认 5 */
  bloggerCommissionRate?: string;
  /** 备注 */
  remark?: string;
  /** 商品明细（至少一项） */
  items: CreateSalesOrderItemDto[];
}

/** 修改订单 DTO（仅待发货状态可修改） */
export interface UpdateSalesOrderDto {
  /** 销售员 ID */
  salespersonId?: string;
  /** 客户名称 */
  customerName?: string;
  /** 下单日期 */
  orderDate?: string;
  /** 运输渠道 ID */
  transportChannelId?: string;
  /** 交易方式 */
  tradeType?: string;
  /** 订单币种（CNY/USD） */
  currency?: string;
  /** 汇率（订单币种→CNY） */
  exchangeRate?: string;
  /** 博主佣金比例(%) */
  bloggerCommissionRate?: string;
  /** 备注 */
  remark?: string;
  /** 商品明细（整体替换） */
  items?: CreateSalesOrderItemDto[];
}

/** 订单查询 DTO */
export interface QuerySalesOrderDto {
  /** 订单编号（模糊） */
  orderNo?: string;
  /** 订单状态 */
  status?: number;
  /** 发货状态 */
  shipmentStatus?: number;
  /** 收款状态 */
  paymentStatus?: number;
  /** 销售员 ID */
  salespersonId?: string;
  /** 开始日期 */
  startDate?: string;
  /** 结束日期 */
  endDate?: string;
  /** 页码 */
  page?: number;
  /** 每页条数 */
  pageSize?: number;
}

/** 创建订单成本 DTO */
export interface CreateSalesOrderCostDto {
  /** 成本类型 ID */
  costTypeId: string;
  /** 金额（原币种） */
  amount: string;
  /** 币种，默认 CNY */
  currency?: string;
  /** 备注 */
  remark?: string;
}

/** 修改订单成本 DTO */
export interface UpdateSalesOrderCostDto {
  /** 金额（原币种） */
  amount?: string;
  /** 币种（变更时重新查汇率） */
  currency?: string;
  /** 备注 */
  remark?: string;
}
