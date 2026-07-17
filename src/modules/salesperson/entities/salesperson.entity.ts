import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 销售员实体
 * 用于订单归属，提成比例默认 40%
 */
@Entity('salesperson')
export class Salesperson extends BaseEntity {
  @Index('idx_name')
  @Column({ type: 'varchar', length: 50, comment: '姓名' })
  name: string;

  @Column({ type: 'varchar', length: 30, nullable: true, comment: '联系电话' })
  phone: string | null = null;

  @Column({
    name: 'commission_rate',
    type: 'decimal',
    precision: 8,
    scale: 4,
    default: 40.0,
    comment: '提成比例（%），默认 40%',
  })
  commissionRate: string = '40.0000';

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;

  @Index('uk_user_id', { unique: true })
  @Column({
    name: 'user_id',
    type: 'bigint',
    nullable: true,
    comment: '关联系统用户ID',
  })
  userId: string | null = null;
}
