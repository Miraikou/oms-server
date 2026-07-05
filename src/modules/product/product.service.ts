import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';
import type { QueryProductDto } from './dto/product.dto';

@Injectable()
export class ProductService extends BaseCrudService<Product> {
  constructor(@InjectRepository(Product) repo: Repository<Product>) {
    super(repo, 'product');
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
}
