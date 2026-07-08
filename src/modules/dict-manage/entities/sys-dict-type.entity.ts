import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 字典类型实体
 * 管理业务中常用的枚举字段分类
 */
@Entity('sys_dict_type')
export class SysDictType extends BaseEntity {
  @Index('uk_dict_type_code', ['typeCode'], { unique: true })
  @Column({
    name: 'type_code',
    type: 'varchar',
    length: 50,
    comment: '字典编码（唯一，如 ORDER_STATUS）',
  })
  typeCode: string;

  @Column({
    name: 'type_name',
    type: 'varchar',
    length: 100,
    comment: '字典名称',
  })
  typeName: string;

  @Column({
    name: 'status',
    type: 'tinyint',
    default: 1,
    comment: '状态：1=启用 0=停用',
  })
  status: number = 1;
}
