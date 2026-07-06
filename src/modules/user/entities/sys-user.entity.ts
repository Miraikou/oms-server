import { Entity, Column, Index, ManyToMany, JoinTable } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';
import { SysRole } from '../../role/entities/sys-role.entity';

/**
 * 系统用户实体
 * 对应 sys_user 表，维护系统登录账号
 */
@Entity('sys_user')
export class SysUser extends BaseEntity {
  @Index('uk_username', { unique: true })
  @Column({ type: 'varchar', length: 50, comment: '登录账号' })
  username: string;

  @Column({ type: 'varchar', length: 255, comment: '密码（bcrypt 加密）' })
  password: string;

  @Index('idx_real_name')
  @Column({ name: 'real_name', type: 'varchar', length: 50, comment: '姓名' })
  realName: string;

  @Column({ type: 'varchar', length: 30, nullable: true, comment: '手机号' })
  phone: string | null = null;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '邮箱' })
  email: string | null = null;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;

  @Column({
    name: 'last_login_time',
    type: 'datetime',
    nullable: true,
    comment: '最后登录时间',
  })
  lastLoginTime: Date | null = null;

  @Column({
    name: 'last_login_ip',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: '最后登录 IP',
  })
  lastLoginIp: string | null = null;

  @ManyToMany(() => SysRole)
  @JoinTable({
    name: 'sys_user_role',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: SysRole[];
}
