import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 发货明细实体
 * 记录本次发货的商品，含销售金额和 FIFO 成本
 * gross_profit = sales_amount - total_cost
 */
@Entity('shipment_item')
export class ShipmentItem extends BaseEntity {
  @Index('idx_shipment_id')
  @Column({ name: 'shipment_id', type: 'bigint', comment: '发货单 ID' })
  shipmentId: string;

  @Index('idx_order_item_id')
  @Column({ name: 'order_item_id', type: 'bigint', comment: '来源订单商品 ID' })
  orderItemId: string;

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '发货数量' })
  quantity: string;

  @Column({
    name: 'sales_unit_price',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售单价（USD）',
  })
  salesUnitPrice: string;

  @Column({
    name: 'sales_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售金额（USD）',
  })
  salesAmount: string;

  @Column({
    name: 'total_cost',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '产品总成本（FIFO 汇总）',
  })
  totalCost: string = '0';

  @Column({
    name: 'gross_profit',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '产品毛利润',
  })
  grossProfit: string = '0';
}
