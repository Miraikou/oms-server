import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { ProductModel } from './entities/product-model.entity';
import { CreateProductModelDto, UpdateProductModelDto } from './dto/product-model.dto';
import { snowflake } from '@/common/utils/snowflake';

@Injectable()
export class ProductModelService {
  constructor(
    @InjectRepository(ProductModel)
    private readonly repo: Repository<ProductModel>,
  ) {}

  /** 分页查询某商品下的型号 */
  async findAll(
    productId: string,
    query: { keyword?: string; status?: number; page?: number; pageSize?: number },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.repo
      .createQueryBuilder('pm')
      .where('pm.productId = :productId', { productId });

    if (query.keyword) {
      qb.andWhere('pm.modelName LIKE :kw', { kw: `%${query.keyword}%` });
    }

    if (query.status !== undefined) {
      qb.andWhere('pm.status = :status', { status: query.status });
    }

    qb.orderBy('pm.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /** 获取某商品所有启用型号（下拉用） */
  async findAllActive(productId: string): Promise<ProductModel[]> {
    return this.repo.find({
      where: { productId, status: 1 },
      order: { createdTime: 'ASC' },
    });
  }

  /** 获取所有启用型号（含商品名，供全局下拉用） */
  async findAllActiveWithProduct() {
    return this.repo
      .createQueryBuilder('pm')
      .innerJoin('product', 'p', 'p.id = pm.productId')
      .addSelect(['p.productName', 'p.supplierId'])
      .where('pm.status = :status', { status: 1 })
      .orderBy('p.productName', 'ASC')
      .addOrderBy('pm.modelName', 'ASC')
      .getRawMany();
  }

  /** 查询单个型号 */
  async findOne(id: string): Promise<ProductModel> {
    const model = await this.repo.findOne({ where: { id } });
    if (!model) {
      throw new NotFoundException('型号不存在');
    }
    return model;
  }

  /** 创建型号 */
  async create(productId: string, dto: CreateProductModelDto): Promise<ProductModel> {
    const entity = this.repo.create({
      id: snowflake.nextId(),
      productId,
      modelName: dto.modelName,
      purchasePrice: dto.purchasePrice || null,
      salePrice: dto.salePrice || null,
      remark: dto.remark || null,
    });

    try {
      return await this.repo.save(entity);
    } catch (error) {
      this.handleDuplicateError(error);
      throw error;
    }
  }

  /** 更新型号 */
  async update(id: string, dto: UpdateProductModelDto): Promise<ProductModel> {
    const model = await this.findOne(id);

    if (dto.modelName !== undefined) model.modelName = dto.modelName;
    if (dto.purchasePrice !== undefined) model.purchasePrice = dto.purchasePrice || null;
    if (dto.salePrice !== undefined) model.salePrice = dto.salePrice || null;
    if (dto.status !== undefined) model.status = dto.status;
    if (dto.remark !== undefined) model.remark = dto.remark || null;

    try {
      return await this.repo.save(model);
    } catch (error) {
      this.handleDuplicateError(error);
      throw error;
    }
  }

  /** 切换状态 */
  async toggleStatus(id: string) {
    const model = await this.findOne(id);
    model.status = model.status === 1 ? 0 : 1;
    await this.repo.save(model);
    return { id: model.id, status: model.status };
  }

  /** 删除型号 */
  async delete(id: string): Promise<void> {
    const model = await this.findOne(id);
    await this.repo.remove(model);
  }

  /** 处理唯一约束冲突 */
  private handleDuplicateError(error: unknown): void {
    if (!(error instanceof QueryFailedError)) return;
    const driverErr = (error as any).driverError;
    if (driverErr?.errno !== 1062) return;
    throw new ConflictException('该商品下已存在相同名称的型号');
  }
}
