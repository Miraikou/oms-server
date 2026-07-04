import { Entity, Column, Index } from 'typeorm'
import { BaseEntity } from '@/common/entities/base.entity'

/**
 * 销售订单实体
 * 一个订单对应一个销售员，可包含多个商品明细
 * 三维状态由系统自动计算：status / shipment_status / payment_status
 */
@Entity('sales_order')
export class SalesOrder extends BaseEntity {
  @Index('uk_order_no', { unique: true })
  @Column({ name: 'order_no', type: 'varchar', length: 50, comment: '订单编号' })
  orderNo: string

  @Index('idx_salesperson_id')
  @Column({ name: 'salesperson_id', type: 'bigint', comment: '销售员 ID' })
  salespersonId: string

  @Column({ name: 'customer_name', type: 'varchar', length: 100, comment: '客户名称' })
  customerName: string

  @Index('idx_order_date')
  @Column({ name: 'order_date', type: 'date', comment: '下单日期' })
  orderDate: Date

  @Index('idx_transport_channel_id')
  @Column({ name: 'transport_channel_id', type: 'bigint', comment: '运输渠道 ID' })
  transportChannelId: string

  @Column({ name: 'trade_type', type: 'varchar', length: 50, comment: '交易方式' })
  tradeType: string

  @Column({ name: 'total_amount_usd', type: 'decimal', precision: 18, scale: 2, default: 0, comment: '订单销售金额（USD）' })
  totalAmountUsd: string = '0'

  @Column({ name: 'received_amount_usd', type: 'decimal', precision: 18, scale: 2, default: 0, comment: '已收金额（USD）' })
  receivedAmountUsd: string = '0'

  @Column({ name: 'received_amount_cny', type: 'decimal', precision: 18, scale: 2, default: 0, comment: '已收人民币（CNY）' })
  receivedAmountCny: string = '0'

  @Index('idx_shipment_status')
  @Column({ name: 'shipment_status', type: 'tinyint', default: 1, comment: '发货状态：1=待发货 2=部分发货 3=全部发货' })
  shipmentStatus: number = 1

  @Index('idx_payment_status')
  @Column({ name: 'payment_status', type: 'tinyint', default: 1, comment: '收款状态：1=未收款 2=部分收款 3=已收款' })
  paymentStatus: number = 1

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '订单状态：1=进行中 2=已完成' })
  status: number = 1
}
