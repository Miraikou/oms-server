import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';
import { OssService } from '@/common/oss/oss.service';
import type { QueryProductDto } from './dto/product.dto';

@Injectable()
export class ProductService extends BaseCrudService<Product> {
  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    private readonly ossService: OssService,
  ) {
    super(repo, 'product');
  }

  /** 创建商品前查重 */
  async create(data: object): Promise<Product> {
    await this.checkDuplicate(data)
    return super.create(data)
  }

  /** 更新商品前查重 */
  async update(id: string, data: object): Promise<Product> {
    await this.checkDuplicate(data, id)
    return super.update(id, data)
  }

  /**
   * 检查商品是否重复
   * 重复条件：(supplierId, categoryId, productName, productModel) 完全一致
   * categoryId 和 productModel 为 NULL 时视为空字符串比较
   */
  private async checkDuplicate(
    data: object,
    excludeId?: string,
  ): Promise<void> {
    const d = data as Record<string, unknown>
    const categoryId = (d.categoryId as string) || ''
    const productModel = (d.productModel as string) || ''

    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.supplierId = :sid', { sid: d.supplierId })
      .andWhere('p.productName = :name', { name: d.productName })
      .andWhere(
        '(p.categoryId = :cid OR (p.categoryId IS NULL AND :cid = :empty))',
        { cid: categoryId, empty: '' },
      )
      .andWhere(
        '(p.productModel = :model OR (p.productModel IS NULL AND :model = :empty2))',
        { model: productModel, empty2: '' },
      )

    if (excludeId) {
      qb.andWhere('p.id != :id', { id: excludeId })
    }

    const exists = await qb.getOne()
    if (exists) {
      throw new ConflictException('该供应商下已存在相同分类、名称、型号的商品')
    }
  }

  protected getSearchFields(): string[] {
    return ['productName', 'productModel'];
  }

  /** 覆写 findAll 以支持供应商和分类筛选 */
  async findAll(query: QueryProductDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.repo.createQueryBuilder('product');

    if (query.keyword) {
      const fields = this.getSearchFields();
      const conditions = fields
        .map((f) => `product.${f} LIKE :kw`)
        .join(' OR ');
      qb.andWhere(`(${conditions})`, { kw: `%${query.keyword}%` });
    }

    if (query.supplierId) {
      qb.andWhere('product.supplierId = :supplierId', {
        supplierId: query.supplierId,
      });
    }

    if (query.categoryId) {
      qb.andWhere('product.categoryId = :categoryId', {
        categoryId: query.categoryId,
      });
    }

    if (query.status !== undefined) {
      qb.andWhere('product.status = :status', { status: query.status });
    }

    qb.orderBy('product.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /** 删除商品，同步删除 OSS 上的商品图片 */
  async delete(id: string): Promise<void> {
    const product = await this.findOne(id);

    // 删除 OSS 图片
    if (product.imageUrl) {
      const objectName = this.ossService.extractObjectName(product.imageUrl);
      if (objectName) {
        await this.ossService.delete(objectName);
      }
    }

    await this.repo.remove(product);
  }
}
