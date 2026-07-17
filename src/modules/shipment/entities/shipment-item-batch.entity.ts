import {
  Entity,
  Column,
  Index,
  PrimaryColumn,
  CreateDateColumn,
} from 'typeorm';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 发货批次明细实体（禁止修改）
 * 记录从某一库存批次消耗了多少商品
 * 一旦生成不可修改，用于 FIFO 成本追溯和利润计算
 */
@Entity('shipment_item_batch')
export class ShipmentItemBatch {
  @PrimaryColumn('bigint')
  id: string = snowflake.nextId();

  @Index('idx_shipment_item_id')
  @Column({ name: 'shipment_item_id', type: 'bigint', comment: '发货明细 ID' })
  shipmentItemId: string;

  @Index('idx_inventory_batch_id')
  @Column({
    name: 'inventory_batch_id',
    type: 'bigint',
    comment: '库存批次 ID',
  })
  inventoryBatchId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '消耗数量' })
  quantity: string;

  @Column({
    name: 'unit_cost_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '批次成本单价（USD）',
  })
  unitCostUsd: string;

  @Column({
    name: 'unit_cost_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '成本单价（CNY）',
  })
  unitCostCny: string = '0';

  @Column({
    name: 'total_cost_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '成本金额（USD）',
  })
  totalCostUsd: string;

  @Column({
    name: 'total_cost_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '成本金额（CNY）',
  })
  totalCostCny: string = '0';

  @Column({
    name: 'currency',
    type: 'varchar',
    length: 10,
    default: 'CNY',
    comment: '成本币种（继承自 InventoryBatch）',
  })
  currency: string = 'CNY';

  @Column({
    name: 'exchange_rate',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 1.0,
    comment: 'USD→CNY汇率',
  })
  exchangeRate: string = '1.0000';

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
}
