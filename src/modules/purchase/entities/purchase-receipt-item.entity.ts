import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 采购入库明细实体
 * 记录实际入库的商品，每条记录对应一个新的库存批次
 * 入库单价直接来源于此记录，为 FIFO 提供成本依据
 */
@Entity('purchase_receipt_item')
export class PurchaseReceiptItem extends BaseEntity {
  @Index('idx_receipt_id')
  @Column({ name: 'receipt_id', type: 'bigint', comment: '入库单 ID' })
  receiptId: string;

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

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '入库数量' })
  quantity: string;

  @Column({
    name: 'unit_price',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '入库单价',
  })
  unitPrice: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, comment: '入库金额' })
  amount: string;
}
