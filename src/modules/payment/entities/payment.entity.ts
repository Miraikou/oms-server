import { Entity, Column, Index } from 'typeorm'
import { BaseEntity } from '@/common/entities/base.entity'

/**
 * 收款记录实体
 * 一个订单可产生多条收款记录，每条保存独立汇率
 * 收款记录提交后禁止修改删除
 */
@Entity('payment')
export class Payment extends BaseEntity {
  @Index('uk_payment_no', { unique: true })
  @Column({ name: 'payment_no', type: 'varchar', length: 50, comment: '收款单号' })
  paymentNo: string

  @Index('idx_order_id')
  @Column({ name: 'order_id', type: 'bigint', comment: '所属订单 ID' })
  orderId: string

  @Index('idx_payment_date')
  @Column({ name: 'payment_date', type: 'datetime', comment: '收款日期' })
  paymentDate: Date

  @Column({ name: 'usd_amount', type: 'decimal', precision: 18, scale: 2, comment: '本次收款（USD）' })
  usdAmount: string

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 10, scale: 6, comment: '实际汇率' })
  exchangeRate: string

  @Column({ name: 'cny_amount', type: 'decimal', precision: 18, scale: 2, comment: '实际到账人民币' })
  cnyAmount: string

  @Column({ name: 'payment_method', type: 'varchar', length: 50, nullable: true, comment: '收款方式' })
  paymentMethod: string | null = null

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '付款方' })
  payer: string | null = null
}
