import { Entity, Column, PrimaryColumn, Index } from 'typeorm'

/**
 * 角色菜单关联实体
 * 对应 sys_role_menu 表，实现角色与菜单的多对多关联
 */
@Entity('sys_role_menu')
export class SysRoleMenu {
  @PrimaryColumn({ name: 'role_id', type: 'bigint', comment: '角色 ID' })
  @Index('idx_role_id')
  roleId: string

  @PrimaryColumn({ name: 'menu_id', type: 'bigint', comment: '菜单 ID' })
  @Index('idx_menu_id')
  menuId: string
}
