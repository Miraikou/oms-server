import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { snowflake } from '@/common/utils/snowflake';
import type {
  CreateExchangeRateDto,
  UpdateExchangeRateDto,
  QueryExchangeRateDto,
  SyncExchangeRateDto,
} from './dto/exchange-rate.dto';

/**
 * 汇率管理服务
 * 负责汇率 CRUD、按日期查询、外部 API 同步
 */
@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    @InjectRepository(ExchangeRate)
    private readonly rateRepo: Repository<ExchangeRate>,
    private readonly dataSource: DataSource,
    private readonly httpService: HttpService,
  ) {}

  /**
   * 按日期查询汇率
   * 查找 effective_date <= date 的最近一条记录
   * 如果找不到则抛异常，提示用户先维护汇率数据
   */
  async getRate(date: string, fromCurrency: string, toCurrency = 'CNY'): Promise<string> {
    // 1. 查找 effective_date <= date 的最新记录
    const rate = await this.rateRepo
      .createQueryBuilder('r')
      .where('r.fromCurrency = :fromCurrency', { fromCurrency })
      .andWhere('r.toCurrency = :toCurrency', { toCurrency })
      .andWhere('r.effectiveDate <= :date', { date })
      .orderBy('r.effectiveDate', 'DESC')
      .getOne();

    if (rate) {
      return rate.rate;
    }

    // 2. 兜底：取该币种最新一条
    const latest = await this.rateRepo
      .createQueryBuilder('r')
      .where('r.fromCurrency = :fromCurrency', { fromCurrency })
      .andWhere('r.toCurrency = :toCurrency', { toCurrency })
      .orderBy('r.effectiveDate', 'DESC')
      .getOne();

    if (latest) {
      this.logger.warn(
        `未找到 ${fromCurrency}→${toCurrency} 在 ${date} 的汇率，使用最新汇率 ${latest.rate}`,
      );
      return latest.rate;
    }

    // 3. 都没有 → 抛异常
    throw new BadRequestException(
      `未找到 ${fromCurrency}→${toCurrency} 的汇率数据，请先在汇率管理中维护`,
    );
  }

  /** 创建汇率记录 */
  async create(dto: CreateExchangeRateDto): Promise<ExchangeRate> {
    const existing = await this.rateRepo.findOne({
      where: {
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency || 'CNY',
        effectiveDate: dto.effectiveDate,
      },
    });

    if (existing) {
      throw new BadRequestException(
        `${dto.fromCurrency}→${dto.toCurrency || 'CNY'} 在 ${dto.effectiveDate} 已有汇率记录`,
      );
    }

    const entity = this.rateRepo.create({
      id: snowflake.nextId(),
      fromCurrency: dto.fromCurrency,
      toCurrency: dto.toCurrency || 'CNY',
      rate: dto.rate,
      effectiveDate: dto.effectiveDate,
    });
    return this.rateRepo.save(entity);
  }

  /** 更新汇率记录（部分更新） */
  async update(id: string, dto: UpdateExchangeRateDto): Promise<ExchangeRate> {
    const entity = await this.rateRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('汇率记录不存在');

    // 显式挑选可修改字段
    if (dto.fromCurrency !== undefined) entity.fromCurrency = dto.fromCurrency;
    if (dto.toCurrency !== undefined) entity.toCurrency = dto.toCurrency;
    if (dto.rate !== undefined) entity.rate = dto.rate;
    if (dto.effectiveDate !== undefined) entity.effectiveDate = dto.effectiveDate;

    return this.rateRepo.save(entity);
  }

  /** 删除汇率记录 */
  async remove(id: string): Promise<void> {
    const entity = await this.rateRepo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('汇率记录不存在');
    await this.rateRepo.remove(entity);
  }

  /** 分页查询汇率列表 */
  async findAll(query: QueryExchangeRateDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.rateRepo.createQueryBuilder('r');

    if (query.fromCurrency) {
      qb.andWhere('r.fromCurrency = :fromCurrency', {
        fromCurrency: query.fromCurrency,
      });
    }
    if (query.toCurrency) {
      qb.andWhere('r.toCurrency = :toCurrency', {
        toCurrency: query.toCurrency,
      });
    }
    if (query.startDate) {
      qb.andWhere('r.effectiveDate >= :startDate', {
        startDate: query.startDate,
      });
    }
    if (query.endDate) {
      qb.andWhere('r.effectiveDate <= :endDate', {
        endDate: query.endDate,
      });
    }

    qb.orderBy('r.fromCurrency', 'ASC')
      .addOrderBy('r.effectiveDate', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /**
   * 从外部 API 同步汇率数据
   * 使用 Frankfurter API，按日期范围逐日拉取
   */
  async syncRates(dto: SyncExchangeRateDto): Promise<{ inserted: number; updated: number }> {
    const base = dto.base || 'USD';
    let inserted = 0;
    let updated = 0;

    // 按日期逐天同步
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);

      try {
        const { data } = await firstValueFrom(
          this.httpService.get('https://api.frankfurter.dev/v2/rates', {
            params: { date: dateStr, base, quotes: 'CNY' },
          }),
        );

        if (data && data[0] && data[0].rate) {
          const rateValue = String(data[0].rate);

          // 查找是否已存在
          const existing = await this.rateRepo.findOne({
            where: {
              fromCurrency: base,
              toCurrency: 'CNY',
              effectiveDate: dateStr,
            },
          });

          if (existing) {
            existing.rate = rateValue;
            await this.rateRepo.save(existing);
            updated++;
          } else {
            await this.rateRepo.save(
              this.rateRepo.create({
                id: snowflake.nextId(),
                fromCurrency: base,
                toCurrency: 'CNY',
                rate: rateValue,
                effectiveDate: dateStr,
              }),
            );
            inserted++;
          }
        }
      } catch (err) {
        this.logger.warn(`同步 ${dateStr} 汇率失败: ${(err as Error).message}`);
      }
    }

    this.logger.log(`汇率同步完成: 新增 ${inserted} 条, 更新 ${updated} 条`);
    return { inserted, updated };
  }
}
