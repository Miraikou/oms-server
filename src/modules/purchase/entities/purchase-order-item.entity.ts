import { Entity, Column, Index } from 'typeorm'
import { BaseEntity } from '@/common/entities/base.entity'

/**
 * 采购明细实体
 * 记录采购单中每种商品的采购数量、单价和金额
 * received_quantity 和 returned_quantity 由系统维护
 */
@Entity('purchase_order_item')
export class PurchaseOrderItem extends BaseEntity {
  @Index('idx_purchase_order_id')
  @Column({ name: 'purchase_order_id', type: 'bigint', comment: '采购单 ID' })
  purchaseOrderId: string

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '采购数量' })
  quantity: string

  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 2, comment: '采购单价' })
  unitPrice: string

  @Column({ type: 'decimal', precision: 18, scale: 2, comment: '采购金额' })
  amount: string

  @Column({ name: 'received_quantity', type: 'decimal', precision: 18, scale: 4, default: 0, comment: '已入库数量' })
  receivedQuantity: string = '0'

  @Column({ name: 'returned_quantity', type: 'decimal', precision: 18, scale: 4, default: 0, comment: '已退货数量' })
  returnedQuantity: string = '0'
}
