import {
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { snowflake } from '../utils/snowflake';

/**
 * 所有实体的基类
 * 包含主键（Snowflake BIGINT）、审计字段（创建人/时间、修改人/时间）、备注
 */
export abstract class BaseEntity {
  @PrimaryColumn('bigint')
  id: string = snowflake.nextId();

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    comment: '创建人ID',
  })
  createdBy: string | null = null;

  @CreateDateColumn({
    name: 'created_time',
    type: 'datetime',
    comment: '创建时间',
  })
  createdTime: Date = new Date();

  @Column({
    name: 'updated_by',
    type: 'bigint',
    nullable: true,
    comment: '修改人ID',
  })
  updatedBy: string | null = null;

  @UpdateDateColumn({
    name: 'updated_time',
    type: 'datetime',
    comment: '修改时间',
  })
  updatedTime: Date = new Date();

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '备注' })
  remark: string | null = null;
}
