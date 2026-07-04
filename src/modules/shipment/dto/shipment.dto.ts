/**
 * 发货管理 DTO
 */

/** 发货明细项 DTO */
export interface CreateShipmentItemDto {
  /** 订单商品 ID */
  orderItemId: string
  /** 发货数量 */
  quantity: string
}

/** 创建发货单 DTO */
export interface CreateShipmentDto {
  /** 订单 ID */
  orderId: string
  /** 快递公司 ID */
  expressCompanyId: string
  /** 快递单号 */
  trackingNo: string
  /** 发货日期 */
  shipmentDate: string
  /** 备注 */
  remark?: string
  /** 发货明细（至少一项） */
  items: CreateShipmentItemDto[]
}

/** 发货查询 DTO */
export interface QueryShipmentDto {
  /** 发货单号（模糊） */
  shipmentNo?: string
  /** 订单 ID */
  orderId?: string
  /** 快递公司 ID */
  expressCompanyId?: string
  /** 快递单号（模糊） */
  trackingNo?: string
  /** 开始日期 */
  startDate?: string
  /** 结束日期 */
  endDate?: string
  /** 页码 */
  page?: number
  /** 每页条数 */
  pageSize?: number
}
