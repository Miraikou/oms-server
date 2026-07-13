import { Entity, Column, Index } from 'typeorm';
import { PrimaryColumn } from 'typeorm';
import { CreateDateColumn } from 'typeorm';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 汇率表实体
 * 按日期存储币种汇率，支持历史汇率查询
 * 唯一约束：(from_currency, to_currency, effective_date)
 */
@Entity('exchange_rate')
@Index('uk_currency_date', ['fromCurrency', 'toCurrency', 'effectiveDate'], {
  unique: true,
})
export class ExchangeRate {
  @PrimaryColumn('bigint')
  id: string = snowflake.nextId();

  @Column({
    name: 'from_currency',
    type: 'varchar',
    length: 10,
    comment: '源币种（USD/EUR/CNY...）',
  })
  fromCurrency: string;

  @Column({
    name: 'to_currency',
    type: 'varchar',
    length: 10,
    default: 'CNY',
    comment: '目标币种，默认 CNY',
  })
  toCurrency: string = 'CNY';

  @Column({
    name: 'rate',
    type: 'decimal',
    precision: 18,
    scale: 4,
    comment: '汇率',
  })
  rate: string;

  @Index('idx_effective_date')
  @Column({
    name: 'effective_date',
    type: 'date',
    comment: '生效日期',
  })
  effectiveDate: string;

  @CreateDateColumn({
    name: 'created_time',
    type: 'datetime',
    comment: '创建时间',
  })
  createdTime: Date = new Date();
}
