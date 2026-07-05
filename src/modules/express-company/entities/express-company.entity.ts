import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/** 快递公司实体 */
@Entity('express_company')
export class ExpressCompany extends BaseEntity {
  @Index('uk_company_name', { unique: true })
  @Column({
    name: 'company_name',
    type: 'varchar',
    length: 100,
    comment: '快递公司名称',
  })
  companyName: string;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
