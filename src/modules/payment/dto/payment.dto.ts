/**
 * 收款管理 DTO
 */

/** 创建收款 DTO */
export interface CreatePaymentDto {
  /** 订单 ID */
  orderId: string
  /** 本次收款（USD） */
  usdAmount: string
  /** 实际汇率 */
  exchangeRate: string
  /** 实际到账人民币 */
  cnyAmount: string
  /** 收款日期 */
  paymentDate: string
  /** 收款方式 */
  paymentMethod?: string
  /** 付款方 */
  payer?: string
  /** 备注 */
  remark?: string
}

/** 收款查询 DTO */
export interface QueryPaymentDto {
  /** 收款单号（模糊） */
  paymentNo?: string
  /** 订单 ID */
  orderId?: string
  /** 开始日期 */
  startDate?: string
  /** 结束日期 */
  endDate?: string
  /** 页码 */
  page?: number
  /** 每页条数 */
  pageSize?: number
}
