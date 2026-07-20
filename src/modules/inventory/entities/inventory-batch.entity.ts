import {
  Entity,
  Column,
  Index,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 库存批次实体
 * FIFO 成本核算的核心，每次采购入库生成一个新批次
 * 采购单价一旦创建不可修改
 */
@Entity('inventory_batch')
@Index('uk_batch_no', ['batchNo'], { unique: true })
@Index('idx_product_inbound', ['productId', 'inboundTime'])
@Index('idx_product_status_avail', ['productId', 'status', 'availableQuantity'])
export class InventoryBatch {
  @PrimaryColumn('bigint')
  id: string = snowflake.nextId();

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string;

  @Index('idx_product_model_id')
  @Column({
    name: 'product_model_id',
    type: 'bigint',
    nullable: true,
    comment: '商品型号 ID',
  })
  productModelId: string | null = null;

  @Index('idx_receipt_item_id')
  @Column({
    name: 'receipt_item_id',
    type: 'bigint',
    nullable: true,
    comment: '来源入库明细 ID（退货恢复/调整时可为空）',
  })
  receiptItemId: string | null = null;

  @Index('idx_batch_source')
  @Column({
    name: 'batch_source',
    type: 'tinyint',
    default: 1,
    comment: '批次来源：1=采购入库 2=退货恢复 3=库存调整',
  })
  batchSource: number = 1;

  @Column({ name: 'batch_no', type: 'varchar', length: 50, comment: '批次号' })
  batchNo: string;

  @Column({
    name: 'unit_cost_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    comment: '批次采购单价（USD）',
  })
  unitCostUsd: string;

  @Column({
    name: 'unit_cost_cny',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
    comment: '批次采购单价（CNY）= unitCostUsd × exchangeRate',
  })
  unitCostCny: string = '0';

  @Column({
    name: 'currency',
    type: 'varchar',
    length: 10,
    default: 'CNY',
    comment: '采购币种',
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
    name: 'original_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    comment: '原始入库数量',
  })
  originalQuantity: string;

  @Column({
    name: 'available_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    comment: '当前可用数量',
  })
  availableQuantity: string;

  @Column({
    name: 'frozen_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
    comment: '当前冻结数量',
  })
  frozenQuantity: string = '0';

  @Column({
    name: 'stock_quantity',
    type: 'decimal',
    precision: 18,
    scale: 4,
    comment: '当前库存（可用+冻结）',
  })
  stockQuantity: string;

  @Index('idx_inbound_time')
  @Column({ name: 'inbound_time', type: 'datetime', comment: '入库日期' })
  inboundTime: Date;

  @Index('idx_freeze_status')
  @Column({
    name: 'freeze_status',
    type: 'tinyint',
    default: 1,
    comment: '冻结状态：1=正常 2=部分冻结 3=全部冻结',
  })
  freezeStatus: number = 1;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '1=有效 2=耗尽' })
  status: number = 1;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '备注' })
  remark: string | null = null;

  @Column({
    name: 'created_by',
    type: 'bigint',
    nullable: true,
    comment: '创建人',
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
    comment: '修改人',
  })
  updatedBy: string | null = null;

  @UpdateDateColumn({
    name: 'updated_time',
    type: 'datetime',
    comment: '修改时间',
  })
  updatedTime: Date = new Date();

  @VersionColumn({ comment: '乐观锁版本号' })
  version: number;
}
