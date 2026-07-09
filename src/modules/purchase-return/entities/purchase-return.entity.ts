import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 采购退货单实体
 */
@Entity('purchase_return')
export class PurchaseReturn extends BaseEntity {
  @Index('uk_return_no', { unique: true })
  @Column({
    name: 'return_no',
    type: 'varchar',
    length: 50,
    comment: '采购退货单号',
  })
  returnNo: string;

  @Index('idx_purchase_order_id')
  @Column({
    name: 'purchase_order_id',
    type: 'bigint',
    comment: '来源采购单 ID',
  })
  purchaseOrderId: string;

  @Index('idx_return_date')
  @Column({ name: 'return_date', type: 'datetime', comment: '退货时间' })
  returnDate: Date;

  @Column({ type: 'varchar', length: 200, nullable: true, comment: '退货原因' })
  reason: string | null = null;
}
