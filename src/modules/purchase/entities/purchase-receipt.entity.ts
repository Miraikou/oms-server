import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { PurchaseOrder } from './purchase-order.entity';

/**
 * 采购入库单实体
 * 记录一次实际入库操作，一个采购单可产生多张入库单
 * 入库完成后自动创建库存批次、更新库存汇总、写入库存流水
 */
@Entity('purchase_receipt')
export class PurchaseReceipt extends BaseEntity {
  @Index('uk_receipt_no', { unique: true })
  @Column({
    name: 'receipt_no',
    type: 'varchar',
    length: 50,
    comment: '入库单号',
  })
  receiptNo: string;

  @Index('idx_purchase_order_id')
  @Column({
    name: 'purchase_order_id',
    type: 'bigint',
    comment: '来源采购单 ID',
  })
  purchaseOrderId: string;

  @ManyToOne(() => PurchaseOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder: PurchaseOrder;

  @Index('idx_receipt_date')
  @Column({ name: 'receipt_date', type: 'datetime', comment: '入库时间' })
  receiptDate: Date;
}
