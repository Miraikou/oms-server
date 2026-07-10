import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 供应商实体
 * 一个供应商可供应多个商品，停用后不允许新增采购单
 */
@Entity('supplier')
export class Supplier extends BaseEntity {
  @Index('uk_supplier_no', { unique: true })
  @Column({
    name: 'supplier_no',
    type: 'varchar',
    length: 50,
    comment: '供应商编号（GYS+流水号）',
  })
  supplierNo: string;

  @Index('uk_supplier_name', { unique: true })
  @Column({
    name: 'supplier_name',
    type: 'varchar',
    length: 100,
    comment: '供应商名称',
  })
  supplierName: string;

  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: '联系人',
  })
  contactName: string | null = null;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 30,
    nullable: true,
    comment: '联系电话',
  })
  contactPhone: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '地址' })
  address: string | null = null;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
