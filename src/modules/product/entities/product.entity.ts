import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 商品实体
 */
@Entity('product')
export class Product extends BaseEntity {
  @Index('idx_supplier_id')
  @Column({ name: 'supplier_id', type: 'bigint', comment: '供应商 ID' })
  supplierId: string;

  @Index('idx_category_id')
  @Column({
    name: 'category_id',
    type: 'bigint',
    nullable: true,
    comment: '商品分类 ID',
  })
  categoryId: string | null = null;

  @Column({
    name: 'product_name',
    type: 'varchar',
    length: 200,
    comment: '商品名称',
  })
  productName: string;

  @Column({
    name: 'image_url',
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: '商品图片',
  })
  imageUrl: string | null = null;

  @Index('idx_status')
  @Column({ type: 'tinyint', default: 1, comment: '状态：1=启用，0=停用' })
  status: number = 1;
}
