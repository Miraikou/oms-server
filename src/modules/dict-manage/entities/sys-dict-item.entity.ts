import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 字典项实体
 * 属于某个字典类型，存储具体的枚举值
 */
@Entity('sys_dict_item')
@Index('idx_dict_item_type_code', ['typeCode'])
@Index('uk_dict_item', ['typeCode', 'itemValue'], { unique: true })
export class SysDictItem extends BaseEntity {
  @Column({
    name: 'type_code',
    type: 'varchar',
    length: 50,
    comment: '所属字典编码',
  })
  typeCode: string;

  @Column({
    name: 'item_value',
    type: 'varchar',
    length: 50,
    comment: '字典值（字符串）',
  })
  itemValue: string;

  @Column({
    name: 'item_label',
    type: 'varchar',
    length: 200,
    comment: '字典标签（显示文本）',
  })
  itemLabel: string;

  @Column({
    name: 'sort_order',
    type: 'int',
    default: 0,
    comment: '排序号（升序）',
  })
  sortOrder: number = 0;

  @Column({
    name: 'status',
    type: 'tinyint',
    default: 1,
    comment: '状态：1=启用 0=停用',
  })
  status: number = 1;
}
