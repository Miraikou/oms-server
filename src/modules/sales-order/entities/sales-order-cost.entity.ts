import { Entity, Column, Index } from 'typeorm'
import { BaseEntity } from '@/common/entities/base.entity'

/**
 * 订单成本实体
 * 记录订单的额外成本（物流、广告、平台手续费等）
 * 唯一约束：orderId + costTypeId
 */
@Entity('sales_order_cost')
@Index('uk_order_cost_type', ['orderId', 'costTypeId'], { unique: true })
export class SalesOrderCost extends BaseEntity {
  @Index('idx_order_id')
  @Column({ name: 'order_id', type: 'bigint', comment: '订单 ID' })
  orderId: string

  @Index('idx_cost_type_id')
  @Column({ name: 'cost_type_id', type: 'bigint', comment: '成本类型 ID' })
  costTypeId: string

  @Column({ type: 'decimal', precision: 18, scale: 2, comment: '成本金额' })
  amount: string
}
