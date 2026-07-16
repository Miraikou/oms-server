import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 客户退货单实体
 * 一个订单可产生多个退货单，退货单提交后不可修改
 * restoreInventory 控制是否恢复库存到原发货批次
 */
@Entity('sales_return')
export class SalesReturn extends BaseEntity {
  @Index('uk_return_no', { unique: true })
  @Column({
    name: 'return_no',
    type: 'varchar',
    length: 50,
    comment: '退货单号',
  })
  returnNo: string;

  @Index('idx_order_id')
  @Column({ name: 'order_id', type: 'bigint', comment: '来源订单 ID' })
  orderId: string;

  @Index('idx_return_date')
  @Column({ name: 'return_date', type: 'datetime', comment: '退货时间' })
  returnDate: Date;

  @Column({
    name: 'restore_inventory',
    type: 'tinyint',
    default: 1,
    comment: '是否恢复库存：1=是 0=否',
  })
  restoreInventory: number = 1;

  @Column({ type: 'varchar', length: 200, nullable: true, comment: '退货原因' })
  reason: string | null = null;

  @Column({
    name: 'refund_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    comment: '退款金额（原币种），null 表示未退款',
  })
  refundAmount: string | null = null;

  @Column({
    name: 'refund_payment_id',
    type: 'bigint',
    nullable: true,
    comment: '关联的退款 Payment ID',
  })
  refundPaymentId: string | null = null;

  @Column({
    name: 'return_cost',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    comment: '本次退货产生额外成本，null 表示无',
  })
  returnCost: string | null = null;

  @Column({
    name: 'return_cost_currency',
    type: 'varchar',
    length: 10,
    nullable: true,
    comment: '退货成本币种',
  })
  returnCostCurrency: string | null = null;
}
