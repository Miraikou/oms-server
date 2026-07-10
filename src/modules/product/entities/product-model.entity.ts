import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 商品型号实体
 * 每个商品可有多个型号，每个型号作为独立 SKU 参与业务
 * 软删除：isDeleted=1 标记已删除，unique_name 生成列实现条件唯一索引
 */
@Entity('product_model')
@Index('uk_product_model_unique_name', ['uniqueName'], { unique: true })
export class ProductModel extends BaseEntity {
  @Index('idx_product_id')
  @Column({ name: 'product_id', type: 'bigint', comment: '所属商品 ID' })
  productId: string;

  @Column({
    name: 'model_name',
    type: 'varchar',
    length: 100,
    comment: '型号名称',
  })
  modelName: string;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;

  @Column({ name: 'is_deleted', type: 'tinyint', default: 0, comment: '软删除：0=未删除，1=已删除' })
  isDeleted: number = 0;

  /**
   * 条件唯一索引辅助列：
   * 未删除时 = CONCAT(product_id, '|', model_name)，参与唯一约束；
   * 已删除时 = NULL，MySQL 唯一索引允许多个 NULL，不冲突。
   */
  @Column({
    name: 'unique_name',
    type: 'varchar',
    length: 250,
    nullable: true,
    generatedType: 'VIRTUAL',
    asExpression: "CASE WHEN `is_deleted` = 0 THEN CONCAT(`product_id`, '|', `model_name`) ELSE NULL END",
    comment: '条件唯一索引辅助列（虚拟生成列）',
  })
  uniqueName: string;
}
