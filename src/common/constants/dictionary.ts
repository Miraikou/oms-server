/**
 * 固定字典常量
 * 定义系统所有核心业务枚举，不允许后台修改
 * 前后端保持一致
 */

/** 字典项结构 */
export interface DictItem {
  code: number;
  label: string;
}

/** 启用/停用状态 */
export const ENABLE_STATUS: DictItem[] = [
  { code: 0, label: '停用' },
  { code: 1, label: '启用' },
];

/** 订单状态（由系统自动计算） */
export const ORDER_STATUS: DictItem[] = [
  { code: 1, label: '进行中' },
  { code: 2, label: '已完成' },
];

/** 发货状态 */
export const SHIPMENT_STATUS: DictItem[] = [
  { code: 1, label: '待发货' },
  { code: 2, label: '部分发货' },
  { code: 3, label: '全部发货' },
];

/** 收款状态 */
export const PAYMENT_STATUS: DictItem[] = [
  { code: 1, label: '未收款' },
  { code: 2, label: '部分收款' },
  { code: 3, label: '已收款' },
];

/** 采购状态 */
export const PURCHASE_STATUS: DictItem[] = [
  { code: 1, label: '待入库' },
  { code: 2, label: '部分入库' },
  { code: 3, label: '全部入库' },
  { code: 4, label: '已关闭' },
];

/** 入库状态 */
export const PURCHASE_RECEIPT_STATUS: DictItem[] = [
  { code: 1, label: '待入库' },
  { code: 2, label: '已入库' },
];

/** 库存流水类型 */
export const INVENTORY_FLOW_TYPE: DictItem[] = [
  { code: 1, label: '采购入库' },
  { code: 2, label: '销售发货' },
  { code: 3, label: '客户退货入库' },
  { code: 4, label: '采购退货出库' },
  { code: 5, label: '库存调整' },
  { code: 6, label: '下单冻结' },
  { code: 7, label: '解冻库存' },
];

/** 库存调整原因 */
export const INVENTORY_ADJUST_REASON: DictItem[] = [
  { code: 1, label: '盘盈' },
  { code: 2, label: '盘亏' },
  { code: 3, label: '系统修正' },
  { code: 4, label: '其他' },
];

/** 退货类型 */
export const RETURN_TYPE: DictItem[] = [
  { code: 1, label: '客户退货' },
  { code: 2, label: '采购退货' },
];

/** 是否恢复库存 */
export const RESTORE_STOCK: DictItem[] = [
  { code: 0, label: '否' },
  { code: 1, label: '是' },
];

/** 库存冻结状态 */
export const FREEZE_STATUS: DictItem[] = [
  { code: 1, label: '正常' },
  { code: 2, label: '部分冻结' },
  { code: 3, label: '全部冻结' },
];

/** 通用是否枚举 */
export const YES_NO: DictItem[] = [
  { code: 0, label: '否' },
  { code: 1, label: '是' },
];

/**
 * 固定字典聚合对象
 * 以字典编码为 key，字典项数组为 value
 */
export const FIXED_DICTIONARIES: Record<string, DictItem[]> = {
  ENABLE_STATUS,
  ORDER_STATUS,
  SHIPMENT_STATUS,
  PAYMENT_STATUS,
  PURCHASE_STATUS,
  PURCHASE_RECEIPT_STATUS,
  INVENTORY_FLOW_TYPE,
  INVENTORY_ADJUST_REASON,
  RETURN_TYPE,
  RESTORE_STOCK,
  FREEZE_STATUS,
  YES_NO,
};

/** 字典类型编码联合类型 */
export type DictType = keyof typeof FIXED_DICTIONARIES;
