import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

@Injectable()
export class CategoryService extends BaseCrudService<Category> {
  constructor(@InjectRepository(Category) repo: Repository<Category>) {
    super(repo, 'category');
  }

  protected getSearchFields(): string[] {
    return ['categoryName'];
  }

  /** 获取分类树形结构 */
  async getTree() {
    const all = await this.repo.find({
      where: { status: 1 },
      order: { sortNo: 'ASC', createdTime: 'ASC' },
    });
    return this.buildTree(all, '0');
  }

  private buildTree(
    items: Category[],
    parentId: string,
  ): (Category & { children?: Category[] })[] {
    return items
      .filter((item) => item.parentId === parentId)
      .map((item) => ({
        ...item,
        children: this.buildTree(items, item.id),
      }));
  }
}
