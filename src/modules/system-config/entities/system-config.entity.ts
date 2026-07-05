import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 系统参数实体
 * Key-Value 结构，支持 STRING/NUMBER/BOOLEAN/JSON 类型
 */
@Entity('system_config')
export class SystemConfig extends BaseEntity {
  @Index('uk_config_key', { unique: true })
  @Column({
    name: 'config_key',
    type: 'varchar',
    length: 100,
    comment: '参数键',
  })
  configKey: string;

  @Column({
    name: 'config_value',
    type: 'varchar',
    length: 500,
    comment: '参数值',
  })
  configValue: string;

  @Column({
    name: 'config_name',
    type: 'varchar',
    length: 100,
    comment: '参数名称',
  })
  configName: string;

  @Column({
    name: 'value_type',
    type: 'varchar',
    length: 20,
    default: 'STRING',
    comment: '值类型：STRING/NUMBER/BOOLEAN/JSON',
  })
  valueType: string = 'STRING';
}
