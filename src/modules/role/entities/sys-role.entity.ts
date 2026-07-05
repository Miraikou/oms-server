import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 系统角色实体
 * 对应 sys_role 表，维护系统角色信息
 */
@Entity('sys_role')
export class SysRole extends BaseEntity {
  @Index('uk_role_name', { unique: true })
  @Column({
    name: 'role_name',
    type: 'varchar',
    length: 50,
    comment: '角色名称',
  })
  roleName: string;

  @Index('uk_role_code', { unique: true })
  @Column({
    name: 'role_code',
    type: 'varchar',
    length: 50,
    comment: '角色编码',
  })
  roleCode: string;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
