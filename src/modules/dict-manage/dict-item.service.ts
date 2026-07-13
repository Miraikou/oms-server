import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysDictItem } from './entities/sys-dict-item.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

/**
 * 字典项 CRUD 服务
 */
@Injectable()
export class DictItemService extends BaseCrudService<SysDictItem> {
  constructor(@InjectRepository(SysDictItem) repo: Repository<SysDictItem>) {
    super(repo, 'di');
  }

  protected getSearchFields(): string[] {
    return ['itemLabel'];
  }

  protected getUpdatableFields(): string[] {
    return ['itemValue', 'itemLabel', 'sortOrder', 'status', 'remark'];
  }

  protected getNullableFields(): string[] {
    return ['remark'];
  }

  /**
   * 覆写分页查询，支持按 typeCode 过滤
   */
  async findAll(query: {
    typeCode?: string;
    keyword?: string;
    status?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ list: SysDictItem[]; total: number; page: number; pageSize: number }> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.repo.createQueryBuilder(this.alias);

    if (query.typeCode) {
      qb.andWhere(`${this.alias}.typeCode = :typeCode`, { typeCode: query.typeCode });
    }

    if (query.keyword) {
      qb.andWhere(`${this.alias}.itemLabel LIKE :kw`, { kw: `%${query.keyword}%` });
    }

    if (query.status !== undefined) {
      qb.andWhere(`${this.alias}.status = :status`, { status: query.status });
    }

    qb.orderBy(`${this.alias}.sortOrder`, 'ASC')
      .addOrderBy(`${this.alias}.itemValue`, 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }
}
