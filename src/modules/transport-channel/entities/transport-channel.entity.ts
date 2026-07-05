import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/** 运输渠道实体 */
@Entity('transport_channel')
export class TransportChannel extends BaseEntity {
  @Index('uk_channel_name', { unique: true })
  @Column({
    name: 'channel_name',
    type: 'varchar',
    length: 100,
    comment: '渠道名称',
  })
  channelName: string;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
