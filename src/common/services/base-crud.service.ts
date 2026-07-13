import { NotFoundException, ConflictException } from '@nestjs/common';
import { Repository, FindOptionsWhere, DeepPartial, QueryFailedError } from 'typeorm';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 通用 CRUD 服务基类
 * 为基础资料模块提供标准化的增删改查操作
 */
export abstract class BaseCrudService<T extends { id: string }> {
  constructor(
    protected readonly repo: Repository<T>,
    protected readonly alias: string,
  ) {}

  /**
   * 分页查询（子类可覆写以添加自定义筛选条件）
   */
  async findAll(query: {
    keyword?: string;
    status?: number;
    page?: number;
    pageSize?: number;
  }): Promise<{ list: T[]; total: number; page: number; pageSize: number }> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.repo.createQueryBuilder(this.alias);

    if (query.keyword) {
      const fields = this.getSearchFields();
      if (fields.length > 0) {
        const conditions = fields
          .map((f) => `${this.alias}.${f} LIKE :kw`)
          .join(' OR ');
        qb.andWhere(`(${conditions})`, { kw: `%${query.keyword}%` });
      }
    }

    if (query.status !== undefined) {
      qb.andWhere(`${this.alias}.status = :status`, { status: query.status });
    }

    qb.orderBy(`${this.alias}.createdTime`, 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /** 获取全部启用的记录（下拉选项用） */
  async findAllActive(): Promise<T[]> {
    return this.repo
      .createQueryBuilder(this.alias)
      .where(`${this.alias}.status = :status`, { status: 1 })
      .orderBy(`${this.alias}.createdTime`, 'DESC')
      .getMany();
  }

  /** 根据 ID 查询详情 */
  async findOne(id: string): Promise<T> {
    const entity = await this.repo.findOne({
      where: { id } as FindOptionsWhere<T>,
    });
    if (!entity) {
      throw new NotFoundException('记录不存在');
    }
    return entity;
  }

  /** 创建记录 */
  async create(data: object): Promise<T> {
    try {
      const entity = this.repo.create({
        id: snowflake.nextId(),
        ...data,
      } as DeepPartial<T>);
      return await this.repo.save(entity);
    } catch (error) {
      this.handleDuplicateError(error);
      throw error
    }
  }

  /** 更新记录（安全模式：白名单过滤 + 空字符串转 null） */
  async update(id: string, data: object): Promise<T> {
    try {
      const entity = await this.findOne(id);
      const updatableFields = this.getUpdatableFields();
      const nullableFields = this.getNullableFields();

      // 只允许更新白名单中的字段
      if (updatableFields.length > 0) {
        for (const field of updatableFields) {
          if ((data as any)[field] !== undefined) {
            let value = (data as any)[field];
            // 可空字段：空字符串转为 null
            if (nullableFields.includes(field) && value === '') {
              value = null;
            }
            (entity as any)[field] = value;
          }
        }
      } else {
        // 子类未定义白名单时，回退到显式排除系统字段
        const systemFields = ['id', 'createdTime', 'updatedTime', 'createdBy', 'updatedBy'];
        for (const key of Object.keys(data)) {
          if (!systemFields.includes(key)) {
            let value = (data as any)[key];
            if (nullableFields.includes(key) && value === '') {
              value = null;
            }
            (entity as any)[key] = value;
          }
        }
      }

      return await this.repo.save(entity);
    } catch (error) {
      this.handleDuplicateError(error);
      throw error;
    }
  }

  /** 获取可更新字段白名单（子类覆写以限制可修改的字段） */
  protected getUpdatableFields(): string[] {
    return [];
  }

  /** 获取可空字段列表（用于空字符串转 null） */
  protected getNullableFields(): string[] {
    return [];
  }

  /**
   * 处理唯一约束冲突（MySQL ER_DUP_ENTRY / errno 1062）
   * 抛出 ConflictException (HTTP 409)，返回友好的中文提示
   */
  private handleDuplicateError(error: unknown): void {
    if (!(error instanceof QueryFailedError)) return

    const driverErr = (error as unknown as { driverError?: { errno?: number; code?: string } }).driverError
    if (driverErr?.errno !== 1062 && driverErr?.code !== 'ER_DUP_ENTRY') return

    const msg = error.message || ''
    const match = msg.match(/Duplicate entry '(.+?)' for key '(.+?)'/)
    const value = match?.[1] ?? ''
    throw new ConflictException(`数据已存在，请勿重复添加（${this.alias}）：${value}`)
  }

  /** 切换启用/停用状态 */
  async toggleStatus(id: string): Promise<{ id: string; status: number }> {
    const entity = (await this.findOne(id)) as T & { status: number };
    entity.status = entity.status === 1 ? 0 : 1;
    await this.repo.save(entity);
    return { id: entity.id, status: entity.status };
  }

  /** 获取关键词搜索字段（子类覆写） */
  protected getSearchFields(): string[] {
    return [];
  }
}
