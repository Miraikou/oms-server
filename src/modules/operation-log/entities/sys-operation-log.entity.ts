import {
  Entity,
  Column,
  Index,
  PrimaryColumn,
  CreateDateColumn,
} from 'typeorm';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 操作日志实体
 * 对应 sys_operation_log 表，记录所有关键业务操作
 */
@Entity('sys_operation_log')
export class SysOperationLog {
  @PrimaryColumn('bigint')
  id: string = snowflake.nextId();

  @Index('idx_module')
  @Column({ type: 'varchar', length: 100, comment: '模块名称' })
  module: string;

  @Column({
    name: 'business_type',
    type: 'varchar',
    length: 50,
    comment: '操作类型（如 create/update/delete）',
  })
  businessType: string;

  @Index('idx_business_id')
  @Column({
    name: 'business_id',
    type: 'bigint',
    nullable: true,
    comment: '业务 ID',
  })
  businessId: string | null = null;

  @Index('idx_created_by')
  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    comment: '操作人 ID',
  })
  createdBy: string | null = null;

  @Column({
    name: 'operator_name',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: '操作人姓名',
  })
  operatorName: string | null = null;

  @Column({
    name: 'request_method',
    type: 'varchar',
    length: 20,
    comment: '请求方式',
  })
  requestMethod: string;

  @Column({
    name: 'request_uri',
    type: 'varchar',
    length: 255,
    comment: '请求地址',
  })
  requestUri: string;

  @Column({
    name: 'request_ip',
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: 'IP 地址',
  })
  requestIp: string | null = null;

  @Column({
    name: 'operation_result',
    type: 'tinyint',
    default: 1,
    comment: '操作结果：1=成功，0=失败',
  })
  operationResult: number = 1;

  @Column({
    name: 'operation_content',
    type: 'text',
    nullable: true,
    comment: '操作内容（JSON 格式变更记录）',
  })
  operationContent: string | null = null;

  @Index('idx_created_time')
  @CreateDateColumn({
    name: 'created_time',
    type: 'datetime',
    comment: '操作时间',
  })
  createdTime: Date;
}
