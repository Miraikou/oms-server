import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 订单商品明细实体
 * 记录订单中每种商品的订购数量、单价、金额
 * shipped_quantity 和 returned_quantity 由系统维护
 */
@Entity('sales_order_item')
export class SalesOrderItem extends BaseEntity {
  @Index('idx_order_id')
  @Column({ name: 'order_id', type: 'bigint', comment: '订单 ID' })
  orderId: string;

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string;

  @Index('idx_product_model_id')
  @Column({
    name: 'product_model_id',
    type: 'bigint',
    nullable: true,
    comment: '商品型号 ID',
  })
  productModelId: string | null = null;

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '订单数量' })
  quantity: string;

  @Column({
    name: 'unit_price_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售单价（USD）',
  })
  unitPriceUsd: string;

  @Column({
    name: 'unit_price_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售单价（CNY）',
  })
  unitPriceCny: string;

  @Column({
    name: 'amount_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售金额（USD）',
  })
  amountUsd: string;

  @Column({
    name: 'amount_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '销售金额（CNY）= amountUsd × 订单汇率',
  })
  amountCny: string = '0';

  @Column({
    name: 'shipped_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
    comment: '已发货数量',
  })
  shippedQuantity: string = '0';

  @Column({
    name: 'returned_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
    comment: '已退货数量',
  })
  returnedQuantity: string = '0';

  @Column({
    name: 'refund_returned_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
    comment: '退货退款数量（不再补发）',
  })
  refundReturnedQuantity: string = '0';

  @Column({
    name: 'refund_only_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
    comment: '仅退款数量（货未退回，客户仍持有，不影响客户持有量）',
  })
  refundOnlyQuantity: string = '0';

  @Column({
    name: 'estimated_cost_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '估算产品成本(USD)，冻结时FIFO批次成本合计',
  })
  estimatedCostUsd: string = '0';

  @Column({
    name: 'estimated_cost_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '估算产品成本(CNY)，冻结时FIFO批次成本合计',
  })
  estimatedCostCny: string = '0';
}
