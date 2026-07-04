import { Entity, Column, Index, PrimaryColumn, CreateDateColumn } from 'typeorm'
import { snowflake } from '@/common/utils/snowflake'

/**
 * 库存流水实体
 * 记录库存的每一次变化，属于审计数据
 * 禁止修改，禁止删除
 */
@Entity('inventory_flow')
export class InventoryFlow {
  @PrimaryColumn('bigint')
  id: string = snowflake.nextId()

  @Index('idx_batch_id')
  @Column({ name: 'batch_id', type: 'bigint', comment: '库存批次 ID' })
  batchId: string

  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string

  @Index('idx_business_type')
  @Column({ name: 'business_type', type: 'tinyint', comment: '业务类型：1=采购入库 2=销售发货 3=客户退货 4=采购退货 5=库存调整 6=下单冻结 7=解冻库存' })
  businessType: number

  @Index('idx_business_id')
  @Column({ name: 'business_id', type: 'bigint', comment: '来源业务 ID' })
  businessId: string

  @Column({ name: 'change_type', type: 'tinyint', comment: '1=入库 2=出库 3=冻结 4=解冻 5=调整' })
  changeType: number

  @Column({ type: 'decimal', precision: 18, scale: 4, comment: '变化数量（正数）' })
  quantity: string

  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 2, nullable: true, comment: '本次单位成本' })
  unitCost: string | null = null

  @Column({ name: 'total_cost', type: 'decimal', precision: 18, scale: 2, nullable: true, comment: '本次总成本' })
  totalCost: string | null = null

  @Column({ name: 'before_available', type: 'decimal', precision: 18, scale: 4, comment: '变更前可用库存' })
  beforeAvailable: string

  @Column({ name: 'after_available', type: 'decimal', precision: 18, scale: 4, comment: '变更后可用库存' })
  afterAvailable: string

  @Column({ name: 'before_frozen', type: 'decimal', precision: 18, scale: 4, comment: '变更前冻结库存' })
  beforeFrozen: string

  @Column({ name: 'after_frozen', type: 'decimal', precision: 18, scale: 4, comment: '变更后冻结库存' })
  afterFrozen: string

  @Column({ name: 'created_by', type: 'bigint', nullable: true, comment: '创建人' })
  createdBy: string | null = null

  @CreateDateColumn({ name: 'created_time', type: 'datetime', comment: '创建时间' })
  createdTime: Date = new Date()

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '备注' })
  remark: string | null = null
}
