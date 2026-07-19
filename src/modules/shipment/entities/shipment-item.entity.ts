import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 发货明细实体
 * 记录本次发货的商品，含销售金额和 FIFO 成本
 * gross_profit = sales_amount_cny - total_cost_cny
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

  @Index('idx_product_model_id')
  @Column({
    name: 'product_model_id',
    type: 'bigint',
    nullable: true,
    comment: '商品型号 ID',
  })
  productModelId: string | null = null;

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '发货数量' })
  quantity: string;

  @Column({
    name: 'sales_unit_price_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售单价（USD）',
  })
  salesUnitPriceUsd: string;

  @Column({
    name: 'sales_unit_price_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售单价（CNY）',
  })
  salesUnitPriceCny: string;

  @Column({
    name: 'sales_amount_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '销售金额（USD）',
  })
  salesAmountUsd: string;

  @Column({
    name: 'sales_amount_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '销售金额（CNY）= salesAmountUsd × exchangeRate',
  })
  salesAmountCny: string = '0';

  @Column({
    name: 'total_cost_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '产品总成本（FIFO 汇总，CNY）',
  })
  totalCostCny: string = '0';

  @Column({
    name: 'total_cost_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    comment: '产品成本(USD)',
  })
  totalCostUsd: string | null = null;

  @Column({
    name: 'gross_profit_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '产品毛利润（CNY）',
  })
  grossProfitCny: string = '0';

  @Column({
    name: 'gross_profit_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    comment: '毛利(USD)',
  })
  grossProfitUsd: string | null = null;

  @Column({
    name: 'currency',
    type: 'varchar',
    length: 10,
    default: 'USD',
    comment: '销售币种（继承自订单）',
  })
  currency: string = 'USD';

  @Column({
    name: 'exchange_rate',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 7.0,
    comment: 'USD→CNY汇率',
  })
  exchangeRate: string = '7.0000';
}
