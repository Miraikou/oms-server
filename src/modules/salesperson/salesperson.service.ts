import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salesperson } from './entities/salesperson.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';
import { RoleService } from '../role/role.service';

@Injectable()
export class SalespersonService extends BaseCrudService<Salesperson> {
  constructor(
    @InjectRepository(Salesperson) repo: Repository<Salesperson>,
    private readonly roleService: RoleService,
  ) {
    super(repo, 'sp');
  }

  protected getSearchFields(): string[] {
    return ['name', 'phone'];
  }

  protected getUpdatableFields(): string[] {
    return ['name', 'phone', 'commissionRate', 'status', 'remark', 'userId'];
  }

  protected getNullableFields(): string[] {
    return ['phone', 'remark', 'userId'];
  }

  /**
   * 覆写分页查询：LEFT JOIN sys_user 获取关联用户名
   */
  async findAll(query: {
    keyword?: string;
    status?: number;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    /** 给 qb 加上通用筛选条件 */
    const applyFilters = (qb: ReturnType<typeof this.repo.createQueryBuilder>) => {
      if (query.keyword) {
        qb.andWhere('(sp.name LIKE :kw OR sp.phone LIKE :kw)', {
          kw: `%${query.keyword}%`,
        });
      }
      if (query.status !== undefined) {
        qb.andWhere('sp.status = :status', { status: query.status });
      }
      return qb.orderBy('sp.createdTime', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize);
    };

    // 查询实体
    const entityQb = applyFilters(
      this.repo.createQueryBuilder('sp'),
    );
    const [list, total] = await entityQb.getManyAndCount();

    // 查询关联用户名（轻量 raw 查询）
    const rawQb = applyFilters(
      this.repo.createQueryBuilder('sp')
        .leftJoin('sys_user', 'u', 'u.id = sp.userId')
        .select('sp.id', 'sp_id')
        .addSelect('u.username', 'sp_username'),
    );
    const rawResults = await rawQb.getRawMany();

    const usernameMap = new Map<string, string>();
    for (const row of rawResults) {
      if (row.sp_username) usernameMap.set(row.sp_id, row.sp_username);
    }

    const enrichedList = list.map((item) => ({
      ...item,
      username: usernameMap.get(item.id),
    }));

    return { list: enrichedList, total, page, pageSize };
  }

  /**
   * 校验 userId 对应的用户是否具有 SALES 角色
   */
  private async validateSalesRole(userId: string | null | undefined): Promise<void> {
    if (!userId) return;

    const roleCodes = await this.roleService.findUserRoleCodes(userId);
    if (!roleCodes.includes('SALES')) {
      throw new BadRequestException('关联的用户必须具有销售角色');
    }
  }

  /**
   * 覆写创建：校验 userId 角色后创建
   */
  async create(data: object): Promise<Salesperson> {
    await this.validateSalesRole((data as any).userId);
    return super.create(data);
  }

  /**
   * 覆写更新：校验 userId 角色后更新
   */
  async update(id: string, data: object): Promise<Salesperson> {
    await this.validateSalesRole((data as any).userId);
    return super.update(id, data);
  }
}
