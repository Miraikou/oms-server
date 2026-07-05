import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { SysOperationLog } from './entities/sys-operation-log.entity'
import { snowflake } from '@/common/utils/snowflake'

/**
 * 操作日志服务
 * 提供操作日志的创建和查询功能
 */
@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name)

  constructor(
    @InjectRepository(SysOperationLog)
    private readonly logRepo: Repository<SysOperationLog>,
  ) {}

  /**
   * 分页查询操作日志
   */
  async findAll(query: {
    module?: string
    businessType?: string
    createdBy?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const qb = this.logRepo.createQueryBuilder('log')

    if (query.module) {
      qb.andWhere('log.module = :module', { module: query.module })
    }

    if (query.businessType) {
      qb.andWhere('log.businessType = :businessType', {
        businessType: query.businessType,
      })
    }

    if (query.createdBy) {
      qb.andWhere('log.createdBy = :createdBy', { createdBy: query.createdBy })
    }

    if (query.startTime) {
      qb.andWhere('log.createdTime >= :startTime', { startTime: query.startTime })
    }

    if (query.endTime) {
      qb.andWhere('log.createdTime <= :endTime', { endTime: query.endTime })
    }

    qb.orderBy('log.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }

  /**
   * 查询日志详情
   */
  async findOne(id: string) {
    return this.logRepo.findOne({ where: { id } })
  }

  /**
   * 记录操作日志
   */
  async create(data: {
    module: string
    businessType: string
    businessId?: string
    createdBy?: string
    operatorName?: string
    requestMethod: string
    requestUri: string
    requestIp?: string
    operationResult?: number
    operationContent?: string
  }) {
    try {
      const log = this.logRepo.create({
        id: snowflake.nextId(),
        module: data.module,
        businessType: data.businessType,
        businessId: data.businessId || null,
        createdBy: data.createdBy || null,
        operatorName: data.operatorName || null,
        requestMethod: data.requestMethod,
        requestUri: data.requestUri,
        requestIp: data.requestIp || null,
        operationResult: data.operationResult ?? 1,
        operationContent: data.operationContent || null,
      })

      await this.logRepo.save(log)
    } catch (error) {
      // 日志记录失败不应影响主业务流程
      this.logger.error('记录操作日志失败', error instanceof Error ? error.stack : String(error))
    }
  }
}
