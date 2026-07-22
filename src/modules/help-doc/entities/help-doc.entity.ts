import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 帮助文档实体
 * 对应 help_doc 表，存储用户手册文档（Markdown 正文）
 * status: 1=已发布，0=草稿
 */
@Entity('help_doc')
export class HelpDoc extends BaseEntity {
  @Column({ type: 'varchar', length: 200, comment: '文档标题' })
  title: string;

  @Index('idx_hd_category')
  @Column({ type: 'varchar', length: 50, comment: '所属分类' })
  category: string;

  @Column({ type: 'longtext', comment: 'Markdown 正文' })
  content: string;

  @Column({
    name: 'route_path',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '绑定路由（逗号分隔多个前缀，用于页面上下文帮助定位）',
  })
  routePath: string | null = null;

  @Column({
    name: 'sort_order',
    type: 'int',
    default: 0,
    comment: '排序号（升序）',
  })
  sortOrder: number = 0;

  @Index('idx_hd_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=已发布，0=草稿' })
  status: number = 1;
}
