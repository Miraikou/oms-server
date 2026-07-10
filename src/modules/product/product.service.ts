import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductModel } from './entities/product-model.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';
import { OssService } from '@/common/oss/oss.service';
import { snowflake } from '@/common/utils/snowflake';
import type { QueryProductDto } from './dto/product.dto';

@Injectable()
export class ProductService extends BaseCrudService<Product> {
  constructor(
    @InjectRepository(Product) repo: Repository<Product>,
    @InjectRepository(ProductModel)
    private readonly modelRepo: Repository<ProductModel>,
    private readonly ossService: OssService,
  ) {
    super(repo, 'product');
  }

  /** 创建商品（支持同时创建型号） */
  async create(data: object): Promise<Product> {
    const d = data as Record<string, unknown>;
    const models = d.models as Array<Record<string, unknown>> | undefined;

    // 剥离 models 字段，避免传入 base create
    const { models: _models, ...rest } = d;
    await this.checkDuplicate(rest);
    const product = await super.create(rest);

    // 批量创建型号
    if (models && models.length > 0) {
      const entities = models.map((m) =>
        this.modelRepo.create({
          id: snowflake.nextId(),
          productId: product.id,
          modelName: m.modelName as string,
          purchasePrice: (m.purchasePrice as string) || null,
          salePrice: (m.salePrice as string) || null,
          remark: (m.remark as string) || null,
        }),
      );
      await this.modelRepo.save(entities);
    }

    return product;
  }

  /** 更新商品前查重 */
  async update(id: string, data: object): Promise<Product> {
    await this.checkDuplicate(data, id)
    return super.update(id, data)
  }

  /**
   * 检查商品是否重复
   * 重复条件：(supplierId, categoryId, productName) 完全一致
   * categoryId 为 NULL 时视为空字符串比较
   */
  private async checkDuplicate(
    data: object,
    excludeId?: string,
  ): Promise<void> {
    const d = data as Record<string, unknown>
    const categoryId = (d.categoryId as string) || ''

    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.supplierId = :sid', { sid: d.supplierId })
      .andWhere('p.productName = :name', { name: d.productName })
      .andWhere(
        '(p.categoryId = :cid OR (p.categoryId IS NULL AND :cid = :empty))',
        { cid: categoryId, empty: '' },
      )

    if (excludeId) {
      qb.andWhere('p.id != :id', { id: excludeId })
    }

    const exists = await qb.getOne()
    if (exists) {
      throw new ConflictException('该供应商下已存在相同分类、名称的商品')
    }
  }

  protected getSearchFields(): string[] {
    return ['productName'];
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

  /** 商品详情（含型号列表） */
  async findDetail(id: string) {
    const product = await this.findOne(id);
    const models = await this.modelRepo.find({
      where: { productId: id },
      order: { createdTime: 'ASC' },
    });
    return { ...product, models };
  }
}
