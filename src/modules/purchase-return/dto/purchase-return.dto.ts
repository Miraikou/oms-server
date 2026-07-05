/** 采购退货明细项 DTO */
export interface CreatePurchaseReturnItemDto {
  /** 采购明细 ID */
  purchaseOrderItemId: string
  /** 退货数量 */
  quantity: string
}

/** 创建采购退货 DTO */
export interface CreatePurchaseReturnDto {
  /** 采购单 ID */
  purchaseOrderId: string
  /** 退货日期 */
  returnDate: string
  /** 是否扣减库存 */
  deductInventory: number
  /** 退货原因 */
  reason?: string
  /** 备注 */
  remark?: string
  /** 退货明细 */
  items: CreatePurchaseReturnItemDto[]
}

/** 采购退货查询 DTO */
export interface QueryPurchaseReturnDto {
  returnNo?: string
  purchaseOrderId?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}
