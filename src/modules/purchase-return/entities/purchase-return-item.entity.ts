import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 采购退货明细实体
 * 关联采购单明细，控制是否扣减库存
 */
@Entity('purchase_return_item')
export class PurchaseReturnItem extends BaseEntity {
  @Index('idx_purchase_return_id')
  @Column({
    name: 'purchase_return_id',
    type: 'bigint',
    comment: '采购退货单 ID',
  })
  purchaseReturnId: string;

  @Index('idx_purchase_order_item_id')
  @Column({
    name: 'purchase_order_item_id',
    type: 'bigint',
    comment: '来源采购明细 ID',
  })
  purchaseOrderItemId: string;

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '退货数量' })
  quantity: string;

  @Column({
    name: 'deduct_inventory',
    type: 'tinyint',
    default: 1,
    comment: '是否扣减库存',
  })
  deductInventory: number = 1;
}
