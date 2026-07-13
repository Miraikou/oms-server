import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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
    private readonly dataSource: DataSource,
  ) {
    super(repo, 'product');
  }

  /** 创建商品（支持同时创建型号，事务保证一致性） */
  async create(data: object): Promise<Product> {
    const d = data as Record<string, unknown>;
    const models = d.models as Array<Record<string, unknown>> | undefined;
    const { models: _models, ...rest } = d;

    await this.checkDuplicate(rest);

    return this.dataSource.transaction(async (manager) => {
      const product = manager.create(Product, {
        id: snowflake.nextId(),
        ...rest,
      });
      const savedProduct = await manager.save(Product, product);

      if (models && models.length > 0) {
        const entities = models.map((m) =>
          manager.create(ProductModel, {
            id: snowflake.nextId(),
            productId: savedProduct.id,
            modelName: m.modelName as string,
            status: typeof m.status === 'number' ? m.status : 1,
            remark: (m.remark as string) || null,
          }),
        );
        await manager.save(ProductModel, entities);
      }

      return savedProduct;
    });
  }

  /** 更新商品（支持同步型号，事务保证一致性） */
  async update(id: string, data: object): Promise<Product> {
    const d = data as Record<string, unknown>;
    const models = d.models as Array<Record<string, unknown>> | undefined;

    await this.checkDuplicate(d, id);

    return this.dataSource.transaction(async (manager) => {
      const product = await manager.findOneBy(Product, { id });
      if (!product) {
        throw new ConflictException('商品不存在');
      }

      // 显式挑选可修改字段，忽略系统字段（id/isDeleted/createdTime 等）
      if (d.supplierId !== undefined) product.supplierId = d.supplierId as string;
      if (d.categoryId !== undefined) product.categoryId = (d.categoryId === '' ? null : d.categoryId) as string | null;
      if (d.productName !== undefined) product.productName = d.productName as string;
      if (d.imageUrl !== undefined) product.imageUrl = (d.imageUrl === '' ? null : d.imageUrl) as string | null;
      if (d.remark !== undefined) product.remark = (d.remark === '' ? null : d.remark) as string | null;
      if (d.status !== undefined) product.status = d.status as number;

      const savedProduct = await manager.save(Product, product);

      if (models) {
        const existingModels = await manager.find(ProductModel, {
          where: { productId: id, isDeleted: 0 },
        });
        const payloadNames = new Set(
          models.filter((m) => m.modelName).map((m) => m.modelName as string),
        );

        for (const m of models) {
          if (m.id) {
            await manager.update(ProductModel, m.id, {
              modelName: m.modelName as string,
              remark: (m.remark as string) || null,
              status: typeof m.status === 'number' ? m.status : 1,
            });
          } else {
            // 检查是否有同名已软删除型号，有则恢复（保留原ID，确保下游单据引用不受影响）
            const exists = await manager.findOne(ProductModel, {
              where: {
                productId: id,
                modelName: m.modelName as string,
              },
            });
            if (exists) {
              await manager.update(ProductModel, exists.id, {
                isDeleted: 0,
                remark: (m.remark as string) || null,
                status: typeof m.status === 'number' ? m.status : 1,
              });
            } else {
              const newModel = manager.create(ProductModel, {
                id: snowflake.nextId(),
                productId: id,
                modelName: m.modelName as string,
                remark: (m.remark as string) || null,
              });
              await manager.save(ProductModel, newModel);
            }
          }
        }

        for (const existing of existingModels) {
          if (!payloadNames.has(existing.modelName)) {
            await manager.update(ProductModel, existing.id, { isDeleted: 1 });
          }
        }
      }

      return savedProduct;
    });
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

  /** 商品详情（含型号列表，排除已删除型号） */
  async findDetail(id: string) {
    const product = await this.findOne(id);
    const models = await this.modelRepo.find({
      where: { productId: id, isDeleted: 0 },
      order: { createdTime: 'ASC' },
    });
    return { ...product, models };
  }
}
