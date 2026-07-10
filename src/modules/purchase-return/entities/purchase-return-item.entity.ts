import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 采购退货明细实体
 * 关联采购单明细
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

  @Index('idx_product_model_id')
  @Column({
    name: 'product_model_id',
    type: 'bigint',
    nullable: true,
    comment: '商品型号 ID',
  })
  productModelId: string | null = null;

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '退货数量' })
  quantity: string;
}
