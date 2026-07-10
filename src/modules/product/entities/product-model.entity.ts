import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 商品型号实体
 * 每个商品可有多个型号，每个型号作为独立 SKU 参与业务
 */
@Entity('product_model')
@Index('uk_product_model', ['productId', 'modelName'], { unique: true })
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

  @Column({
    name: 'purchase_price',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    comment: '默认采购价',
  })
  purchasePrice: string | null = null;

  @Column({
    name: 'sale_price',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    comment: '默认销售价',
  })
  salePrice: string | null = null;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
