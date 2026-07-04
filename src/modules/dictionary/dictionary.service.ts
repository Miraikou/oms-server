import { Injectable, Inject, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, ObjectLiteral } from 'typeorm'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '@/common/redis/redis.module'
import { FIXED_DICTIONARIES } from '@/common/constants/dictionary'
import { Supplier } from '@/modules/supplier/entities/supplier.entity'
import { Category } from '@/modules/category/entities/category.entity'
import { CostType } from '@/modules/cost-type/entities/cost-type.entity'
import { ExpressCompany } from '@/modules/express-company/entities/express-company.entity'
import { TransportChannel } from '@/modules/transport-channel/entities/transport-channel.entity'
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity'

/** 动态字典项（统一返回格式） */
export interface DynamicDictItem {
  code: string
  label: string
}

/** Redis 缓存 TTL：30 分钟 */
const CACHE_TTL = 30 * 60

/**
 * 字典服务
 * 提供固定字典查询 + 动态字典查询（带 Redis 缓存）
 */
@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name)

  /** 动态字典类型 → 数据源映射 */
  private readonly dynamicSources: Record<string, { repo: Repository<ObjectLiteral>; codeField: string; labelField: string }>

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(Category) private readonly categoryRepo: Repository<Category>,
    @InjectRepository(CostType) private readonly costTypeRepo: Repository<CostType>,
    @InjectRepository(ExpressCompany) private readonly expressCompanyRepo: Repository<ExpressCompany>,
    @InjectRepository(TransportChannel) private readonly transportChannelRepo: Repository<TransportChannel>,
    @InjectRepository(Salesperson) private readonly salespersonRepo: Repository<Salesperson>,
  ) {
    // 注册动态字典数据源映射
    this.dynamicSources = {
      COST_TYPE: { repo: this.costTypeRepo, codeField: 'id', labelField: 'costName' },
      EXPRESS_COMPANY: { repo: this.expressCompanyRepo, codeField: 'id', labelField: 'companyName' },
      TRANSPORT_CHANNEL: { repo: this.transportChannelRepo, codeField: 'id', labelField: 'channelName' },
      CATEGORY: { repo: this.categoryRepo, codeField: 'id', labelField: 'categoryName' },
      SALESPERSON: { repo: this.salespersonRepo, codeField: 'id', labelField: 'name' },
      SUPPLIER: { repo: this.supplierRepo, codeField: 'id', labelField: 'supplierName' },
    }
  }

  /**
   * 获取所有固定字典
   * @returns 以字典编码为 key 的字典项 map
   */
  getFixedDictionaries(): Record<string, Array<{ code: number; label: string }>> {
    return FIXED_DICTIONARIES
  }

  /**
   * 获取指定动态字典（带 Redis 缓存）
   * @param type 字典类型（如 COST_TYPE、EXPRESS_COMPANY 等）
   * @returns 字典项数组
   */
  async getDynamicDictionary(type: string): Promise<DynamicDictItem[]> {
    const cacheKey = `dict:${type}`

    // 1. 先查 Redis 缓存
    const cached = await this.redis.get(cacheKey)
    if (cached) {
      this.logger.debug(`缓存命中: ${cacheKey}`)
      return JSON.parse(cached)
    }

    // 2. 从数据库查询
    const source = this.dynamicSources[type]
    if (!source) {
      this.logger.warn(`未知动态字典类型: ${type}`)
      return []
    }

    const { repo, codeField, labelField } = source
    const entities = await repo
      .createQueryBuilder('e')
      .select([`e.${codeField}`, `e.${labelField}`])
      .where('e.status = :status', { status: 1 })
      .orderBy(`e.${labelField}`, 'ASC')
      .getRawMany()

    const items: DynamicDictItem[] = entities.map((row) => ({
      code: String(row[`e_${codeField}`]),
      label: row[`e_${labelField}`],
    }))

    // 3. 写入 Redis 缓存
    await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(items))
    this.logger.debug(`缓存已更新: ${cacheKey}，${items.length} 项`)

    return items
  }

  /**
   * 清除指定动态字典的 Redis 缓存
   * @param type 字典类型
   */
  async invalidateCache(type: string): Promise<void> {
    const cacheKey = `dict:${type}`
    await this.redis.del(cacheKey)
    this.logger.debug(`缓存已清除: ${cacheKey}`)
  }
}
