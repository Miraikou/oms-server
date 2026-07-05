/** 客户退货明细项 DTO */
export interface CreateSalesReturnItemDto {
  /** 发货明细 ID */
  shipmentItemId: string
  /** 退货数量 */
  quantity: string
}

/** 创建客户退货 DTO */
export interface CreateSalesReturnDto {
  /** 订单 ID */
  orderId: string
  /** 退货日期 */
  returnDate: string
  /** 是否恢复库存 */
  restoreInventory: number
  /** 退货原因 */
  reason?: string
  /** 备注 */
  remark?: string
  /** 退货明细 */
  items: CreateSalesReturnItemDto[]
}

/** 客户退货查询 DTO */
export interface QuerySalesReturnDto {
  returnNo?: string
  orderId?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}
