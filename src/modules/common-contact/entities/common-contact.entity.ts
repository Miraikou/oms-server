import { Entity, Column, Index } from 'typeorm'
import { BaseEntity } from '@/common/entities/base.entity'

/**
 * 常用联系人实体
 * 辅助录单，自动从历史订单提取，也可手动新增
 */
@Entity('common_contact')
export class CommonContact extends BaseEntity {
  @Index('uk_contact_name', { unique: true })
  @Column({ name: 'contact_name', type: 'varchar', length: 100, comment: '联系人名称' })
  contactName: string

  @Column({ name: 'usage_count', type: 'int', default: 0, comment: '使用次数' })
  usageCount: number = 0

  @Index('idx_last_used_time')
  @Column({ name: 'last_used_time', type: 'datetime', nullable: true, comment: '最后使用时间' })
  lastUsedTime: Date | null = null
}
