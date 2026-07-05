import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 库存调整明细实体
 * 每条记录对应一种商品的调整
 */
@Entity('inventory_adjustment_item')
export class InventoryAdjustmentItem extends BaseEntity {
  @Index('idx_adjustment_id')
  @Column({ name: 'adjustment_id', type: 'bigint', comment: '调整单 ID' })
  adjustmentId: string;

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string;

  @Index('idx_batch_id')
  @Column({
    name: 'batch_id',
    type: 'bigint',
    nullable: true,
    comment: '调整批次（可为空）',
  })
  batchId: string | null = null;

  @Column({
    name: 'change_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    comment: '调整数量（正=增加，负=减少）',
  })
  changeQuantity: string;
}
