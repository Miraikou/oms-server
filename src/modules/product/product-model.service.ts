import {
	Injectable,
	NotFoundException,
	ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { ProductModel } from './entities/product-model.entity';
import { Product } from './entities/product.entity';
import {
	CreateProductModelDto,
	UpdateProductModelDto,
} from './dto/product-model.dto';
import { snowflake } from '@/common/utils/snowflake';

@Injectable()
export class ProductModelService {
	constructor(
		@InjectRepository(ProductModel)
		private readonly repo: Repository<ProductModel>,
		@InjectRepository(Product)
		private readonly productRepo: Repository<Product>,
	) {}

	/** 分页查询某商品下的型号 */
	async findAll(
		productId: string,
		query: {
			keyword?: string;
			status?: number;
			page?: number;
			pageSize?: number;
		},
	) {
		const page = query.page || 1;
		const pageSize = query.pageSize || 20;

		const qb = this.repo
			.createQueryBuilder('pm')
			.where('pm.productId = :productId', { productId })
			.andWhere('pm.isDeleted = :isDeleted', { isDeleted: 0 });

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
			where: { productId, status: 1, isDeleted: 0 },
			order: { createdTime: 'ASC' },
		});
	}

	/** 获取所有启用型号（含商品名，供全局下拉/展示用） */
	async findAllActiveWithProduct() {
		const models = await this.repo.find({
			where: { status: 1, isDeleted: 0 },
			order: { productId: 'ASC', modelName: 'ASC' },
		});
		if (!models.length) return [];
		const productIds = [...new Set(models.map((m) => m.productId))];
		const products = await this.productRepo
			.createQueryBuilder('p')
			.select(['p.id', 'p.productName'])
			.where('p.id IN (:...ids)', { ids: productIds })
			.getMany();
		const nameMap = new Map(products.map((p) => [p.id, p.productName]));
		return models.map((m) => ({
			...m,
			productName: nameMap.get(m.productId) || '',
		}));
	}

	/** 查询单个型号（排除已删除） */
	async findOne(id: string): Promise<ProductModel> {
		const model = await this.repo.findOne({ where: { id, isDeleted: 0 } });
		if (!model) {
			throw new NotFoundException('型号不存在');
		}
		return model;
	}

	/** 创建型号 */
	async create(
		productId: string,
		dto: CreateProductModelDto,
	): Promise<ProductModel> {
		// 检查是否有同名已软删除型号，有则恢复（保留原ID，确保下游单据引用不受影响）
		const existsDeleted = await this.repo.findOne({
			where: { productId, modelName: dto.modelName, isDeleted: 1 },
		});

		if (existsDeleted) {
			existsDeleted.isDeleted = 0;
			existsDeleted.remark = dto.remark || null;
			existsDeleted.minimumStock =
				dto.minimumStock == null ? null : String(dto.minimumStock);
			return this.repo.save(existsDeleted);
		}

		const entity = this.repo.create({
			id: snowflake.nextId(),
			productId,
			modelName: dto.modelName,
			remark: dto.remark || null,
			minimumStock: dto.minimumStock == null ? null : String(dto.minimumStock),
		});

		try {
			return await this.repo.save(entity);
		} catch (error) {
			this.handleDuplicateError(error);
			throw error;
		}
	}

	/** 更新型号 */
	async update(
		id: string,
		dto: UpdateProductModelDto,
	): Promise<ProductModel> {
		const model = await this.findOne(id);

		// 显式挑选可修改字段
		if (dto.modelName !== undefined) model.modelName = dto.modelName;
		if (dto.status !== undefined) model.status = dto.status;
		if (dto.remark !== undefined) model.remark = dto.remark === '' ? null : dto.remark;
		if (dto.minimumStock !== undefined)
			model.minimumStock =
				dto.minimumStock === null ? null : String(dto.minimumStock);

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

	/** 删除型号（软删除） */
	async delete(id: string): Promise<void> {
		const model = await this.findOne(id);
		model.isDeleted = 1;
		await this.repo.save(model);
	}

	/** 处理唯一约束冲突 */
	private handleDuplicateError(error: unknown): void {
		if (!(error instanceof QueryFailedError)) return;
		const driverErr = (error as any).driverError;
		if (driverErr?.errno !== 1062) return;
		throw new ConflictException('该商品下已存在相同名称的型号');
	}
}
