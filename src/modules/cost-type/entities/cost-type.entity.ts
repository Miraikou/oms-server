import { Entity, Column, Index } from 'typeorm'
import { BaseEntity } from '@/common/entities/base.entity'

/** 成本类型实体 */
@Entity('cost_type')
export class CostType extends BaseEntity {
  @Index('uk_cost_name', { unique: true })
  @Column({ name: 'cost_name', type: 'varchar', length: 100, comment: '成本名称' })
  costName: string

  @Column({ name: 'sort_no', type: 'int', default: 0, comment: '排序号' })
  sortNo: number = 0

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1
}
