import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
import { SysSequence } from '@/common/entities/sys-sequence.entity'
import { snowflake } from '@/common/utils/snowflake'

/**
 * 业务编号类型
 * 日期型：前缀 + yyyyMMdd + 4位流水号（按天重置）
 * 永久型：前缀 + 4位流水号（永不重置）
 */
export type BizType =
  | 'SO'  // 销售订单
  | 'CG'  // 采购订单
  | 'FH'  // 发货单
  | 'SK'  // 收款单
  | 'TH'  // 客户退货
  | 'PT'  // 采购退货
  | 'KC'  // 库存调整
  | 'BT'  // 库存批次
  | 'CP'  // 商品编码
  | 'SP'  // 销售员编码
  | 'GYS' // 供应商编码

/** 永久流水类型（不含日期） */
const PERMANENT_TYPES: Set<string> = new Set(['CP', 'SP', 'GYS'])

/** 永久流水类型的固定日期占位符 */
const PERMANENT_DATE = '00000000'

/** 流水号最小补零宽度 */
const MIN_PAD_WIDTH = 4

/**
 * 编号生成服务
 * 基于 sys_sequence 表 + 事务原子更新，保证并发安全
 * 生成格式：前缀 + [日期] + 流水号
 */
@Injectable()
export class SequenceService {
  private readonly logger = new Logger(SequenceService.name)

  constructor(
    @InjectRepository(SysSequence)
    private readonly repo: Repository<SysSequence>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 生成业务编号
   * 在数据库事务中使用 SELECT ... FOR UPDATE 保证并发安全
   *
   * @param bizType 业务类型前缀
   * @returns 格式化的业务编号字符串
   */
  async generate(bizType: BizType): Promise<string> {
    const bizDate = PERMANENT_TYPES.has(bizType)
      ? PERMANENT_DATE
      : this.getCurrentDate()

    // 在事务中执行，保证原子性
    const result = await this.dataSource.transaction(async (manager) => {
      // 使用悲观锁查询当前记录
      let record = await manager
        .createQueryBuilder(SysSequence, 'seq')
        .setLock('pessimistic_write')
        .where('seq.biz_type = :bizType', { bizType })
        .andWhere('seq.biz_date = :bizDate', { bizDate })
        .getOne()

      if (!record) {
        // 新日期 / 新类型，初始化流水号为 1
        record = manager.create(SysSequence, {
          id: snowflake.nextId(),
          bizType,
          bizDate,
          currentValue: 1,
        })
        await manager.save(record)
      } else {
        // 流水号 +1
        record.currentValue += 1
        await manager.save(record)
      }

      return record.currentValue
    })

    // 格式化编号
    const seqStr = String(result).padStart(MIN_PAD_WIDTH, '0')
    const datePart = PERMANENT_TYPES.has(bizType) ? '' : bizDate
    const bizNo = `${bizType}${datePart}${seqStr}`

    this.logger.debug(`生成编号: ${bizNo}`)
    return bizNo
  }

  /**
   * 获取当前日期（yyyyMMdd 格式）
   */
  private getCurrentDate(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}${month}${day}`
  }
}
