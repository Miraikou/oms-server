import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 客户退货明细实体
 * 关联 shipment_item 追溯原发货批次
 * restoreInventory 冗余保存，支持未来扩展
 */
@Entity('sales_return_item')
export class SalesReturnItem extends BaseEntity {
  @Index('idx_sales_return_id')
  @Column({ name: 'sales_return_id', type: 'bigint', comment: '退货单 ID' })
  salesReturnId: string;

  @Index('idx_shipment_item_id')
  @Column({
    name: 'shipment_item_id',
    type: 'bigint',
    comment: '来源发货明细 ID',
  })
  shipmentItemId: string;

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '退货数量' })
  quantity: string;

  @Column({
    name: 'restore_inventory',
    type: 'tinyint',
    default: 1,
    comment: '是否恢复库存',
  })
  restoreInventory: number = 1;
}
