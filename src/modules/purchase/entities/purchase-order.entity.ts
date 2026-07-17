import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 采购单实体
 * 一个采购单对应一个供应商，可包含多个商品明细
 * 状态由系统自动计算：待入库→部分入库→全部入库
 */
@Entity('purchase_order')
export class PurchaseOrder extends BaseEntity {
  @Index('uk_purchase_no', { unique: true })
  @Column({
    name: 'purchase_no',
    type: 'varchar',
    length: 50,
    comment: '采购单号',
  })
  purchaseNo: string;

  @Index('idx_supplier_id')
  @Column({ name: 'supplier_id', type: 'bigint', comment: '供应商 ID' })
  supplierId: string;

  @Column({ type: 'varchar', length: 10, default: 'CNY', comment: '币种' })
  currency: string = 'CNY';

  @Column({
    name: 'exchange_rate',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 7.0,
    comment: 'USD→CNY汇率',
  })
  exchangeRate: string = '7.0000';

  @Column({
    name: 'total_amount_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '采购总金额（USD）',
  })
  totalAmountUsd: string = '0';

  @Column({
    name: 'total_amount_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '采购总金额（CNY）= totalAmountUsd × exchangeRate',
  })
  totalAmountCny: string = '0';

  @Index('idx_purchase_date')
  @Column({ name: 'purchase_date', type: 'date', comment: '采购日期' })
  purchaseDate: Date;

  @Index('idx_status')
  @Column({
    type: 'tinyint',
    default: 1,
    comment: '状态：1=待入库 2=部分入库 3=全部入库 4=已关闭',
  })
  status: number = 1;

  @Column({
    name: 'return_status',
    type: 'tinyint',
    default: 1,
    comment: '退货状态：1=未退货 2=部分退货 3=全部退货',
  })
  returnStatus: number = 1;
}
