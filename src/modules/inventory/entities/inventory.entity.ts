import { Entity, Column, Index, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm'
import { snowflake } from '@/common/utils/snowflake'

/**
 * 库存汇总实体
 * 每个商品仅一条记录，用于快速查询当前库存
 * 属于缓存数据，所有数量均可由库存批次重新推导
 */
@Entity('inventory')
@Index('uk_product_id', ['productId'], { unique: true })
export class Inventory {
  @PrimaryColumn('bigint')
  id: string = snowflake.nextId()

  @Column({ name: 'product_id', type: 'bigint', comment: '商品 ID' })
  productId: string

  @Column({ name: 'available_quantity', type: 'decimal', precision: 18, scale: 4, default: 0, comment: '可用库存' })
  availableQuantity: string = '0'

  @Column({ name: 'frozen_quantity', type: 'decimal', precision: 18, scale: 4, default: 0, comment: '冻结库存' })
  frozenQuantity: string = '0'

  @Column({ name: 'stock_quantity', type: 'decimal', precision: 18, scale: 4, default: 0, comment: '实际库存（可用+冻结）' })
  stockQuantity: string = '0'

  @Column({ name: 'minimum_stock', type: 'decimal', precision: 18, scale: 4, default: 0, comment: '最低库存预警值' })
  minimumStock: string = '0'

  @Column({ name: 'created_by', type: 'bigint', nullable: true, comment: '创建人' })
  createdBy: string | null = null

  @CreateDateColumn({ name: 'created_time', type: 'datetime', comment: '创建时间' })
  createdTime: Date = new Date()

  @Column({ name: 'updated_by', type: 'bigint', nullable: true, comment: '修改人' })
  updatedBy: string | null = null

  @UpdateDateColumn({ name: 'updated_time', type: 'datetime', comment: '更新时间' })
  updatedTime: Date = new Date()

  @Column({ type: 'int', default: 0, comment: '乐观锁版本号' })
  version: number = 0
}
