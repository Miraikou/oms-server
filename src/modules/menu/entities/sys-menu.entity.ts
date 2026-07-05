import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 系统菜单实体
 * 对应 sys_menu 表，采用树形结构，支持目录/菜单/按钮三种类型
 * menuType: 0=目录, 1=菜单, 2=按钮
 */
@Entity('sys_menu')
export class SysMenu extends BaseEntity {
  @Index('idx_parent_id')
  @Column({
    name: 'parent_id',
    type: 'bigint',
    nullable: true,
    comment: '父菜单 ID（顶级为 null）',
  })
  parentId: string | null = null;

  @Column({
    name: 'menu_name',
    type: 'varchar',
    length: 100,
    comment: '菜单名称',
  })
  menuName: string;

  @Column({
    name: 'menu_type',
    type: 'tinyint',
    comment: '菜单类型：0=目录，1=菜单，2=按钮',
  })
  menuType: number;

  @Index('idx_permission')
  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '权限标识（如 order:create）',
  })
  permission: string | null = null;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    comment: '前端路由路径',
  })
  path: string | null = null;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    comment: 'React 组件路径',
  })
  component: string | null = null;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '图标名称' })
  icon: string | null = null;

  @Column({
    name: 'sort_no',
    type: 'int',
    default: 0,
    comment: '排序号（升序）',
  })
  sortNo: number = 0;

  @Column({ type: 'tinyint', default: 1, comment: '是否显示：1=显示，0=隐藏' })
  visible: number = 1;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
