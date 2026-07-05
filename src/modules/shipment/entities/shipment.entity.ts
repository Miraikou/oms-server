import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 发货单实体
 * 一个订单可产生多个发货单，每个发货单对应一个快递单号
 * 发货单创建后不可修改、不可撤销
 */
@Entity('shipment')
@Index('uk_express_tracking', ['expressCompanyId', 'trackingNo'], {
  unique: true,
})
export class Shipment extends BaseEntity {
  @Index('uk_shipment_no', { unique: true })
  @Column({
    name: 'shipment_no',
    type: 'varchar',
    length: 50,
    comment: '发货单号',
  })
  shipmentNo: string;

  @Index('idx_order_id')
  @Column({ name: 'order_id', type: 'bigint', comment: '所属订单 ID' })
  orderId: string;

  @Index('idx_express_company_id')
  @Column({
    name: 'express_company_id',
    type: 'bigint',
    comment: '快递公司 ID',
  })
  expressCompanyId: string;

  @Index('idx_tracking_no')
  @Column({
    name: 'tracking_no',
    type: 'varchar',
    length: 100,
    comment: '快递单号',
  })
  trackingNo: string;

  @Index('idx_shipment_date')
  @Column({ name: 'shipment_date', type: 'datetime', comment: '发货时间' })
  shipmentDate: Date;

  @Column({ type: 'tinyint', default: 1, comment: '状态：1=已发货' })
  status: number = 1;
}
