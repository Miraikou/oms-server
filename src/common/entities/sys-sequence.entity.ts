import { Entity, Column, Index, UpdateDateColumn } from 'typeorm';

/**
 * 业务编号序列表
 * 用于生成各业务单据的可读编号（如 SO202607030001）
 * 唯一约束：biz_type + biz_date
 */
@Entity('sys_sequence')
@Index('uk_biz_type_date', ['bizType', 'bizDate'], { unique: true })
export class SysSequence {
  @Column({ name: 'id', type: 'bigint', primary: true })
  id: string;

  @Column({
    name: 'biz_type',
    type: 'varchar',
    length: 20,
    comment: '业务类型（SO/CG/FH/SK/TH/PT/KC/BT/CP/SP/GYS）',
  })
  bizType: string;

  @Column({
    name: 'biz_date',
    type: 'char',
    length: 8,
    comment: '日期 yyyyMMdd，永久流水固定为 00000000',
  })
  bizDate: string;

  @Column({
    name: 'current_value',
    type: 'bigint',
    default: 0,
    comment: '当前流水号',
  })
  currentValue: number = 0;

  @UpdateDateColumn({
    name: 'updated_time',
    type: 'datetime',
    comment: '更新时间',
  })
  updatedTime: Date = new Date();
}
