import { Entity, PrimaryColumn, Index } from 'typeorm';

/**
 * 用户角色关联实体
 * 对应 sys_user_role 表，实现用户与角色的多对多关联
 */
@Entity('sys_user_role')
export class SysUserRole {
  @PrimaryColumn({ name: 'user_id', type: 'bigint', comment: '用户 ID' })
  userId: string;

  @PrimaryColumn({ name: 'role_id', type: 'bigint', comment: '角色 ID' })
  @Index('idx_role_id')
  roleId: string;
}
