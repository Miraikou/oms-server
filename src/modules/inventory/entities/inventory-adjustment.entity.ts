import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 库存调整单实体
 * 用于修正库存（盘盈/盘亏/系统修正/其他）
 */
@Entity('inventory_adjustment')
export class InventoryAdjustment extends BaseEntity {
  @Index('uk_adjustment_no', { unique: true })
  @Column({
    name: 'adjustment_no',
    type: 'varchar',
    length: 50,
    comment: '调整单号',
  })
  adjustmentNo: string;

  @Index('idx_adjustment_date')
  @Column({ name: 'adjustment_date', type: 'datetime', comment: '调整时间' })
  adjustmentDate: Date;

  @Column({ type: 'varchar', length: 200, comment: '调整原因' })
  reason: string;
}
