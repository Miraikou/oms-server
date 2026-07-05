import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 商品分类实体
 * 支持无限层级树形结构
 */
@Entity('category')
export class Category extends BaseEntity {
  @Index('idx_parent_id')
  @Column({
    name: 'parent_id',
    type: 'bigint',
    default: 0,
    comment: '父分类 ID，0=顶级',
  })
  parentId: string = '0';

  @Column({
    name: 'category_name',
    type: 'varchar',
    length: 100,
    comment: '分类名称',
  })
  categoryName: string;

  @Column({ name: 'sort_no', type: 'int', default: 0, comment: '排序号' })
  sortNo: number = 0;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
