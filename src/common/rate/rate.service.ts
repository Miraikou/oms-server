import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SystemConfigService } from '@/modules/system-config/system-config.service';
import { ExchangeRate } from '@/modules/rate/entities/exchange-rate.entity';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 汇率查询服务
 * 从 exchange_rate 表按日期查询汇率，查不到时自动从外部 API 拉取并缓存
 * 供所有业务模块调用
 */
@Injectable()
export class RateService {
  private readonly logger = new Logger(RateService.name);

  constructor(
    @InjectRepository(ExchangeRate)
    private readonly rateRepo: Repository<ExchangeRate>,
    private readonly httpService: HttpService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  /**
   * 获取默认汇率（USD→CNY）
   * 从系统参数 DEFAULT_EXCHANGE_RATE 读取，未配置时返回 '6.8'
   */
  async getDefaultRate(): Promise<string> {
    return (await this.systemConfigService.getByKey('DEFAULT_EXCHANGE_RATE')) || '6.8';
  }

  /**
   * 按日期查询汇率
   * 优先精确匹配当天；无记录时自动从 Frankfurter API 拉取并存表
   * @param date 业务日期（YYYY-MM-DD）
   * @param fromCurrency 源币种（如 USD）
   * @param toCurrency 目标币种，默认 CNY
   * @returns 汇率字符串
   */
  async getRate(
    date: string,
    fromCurrency: string,
    toCurrency = 'CNY',
  ): Promise<string> {
    // 1. 精确匹配当天
    const exact = await this.rateRepo.findOne({
      where: {
        fromCurrency,
        toCurrency,
        effectiveDate: date,
      },
    });
    if (exact) return exact.rate;

    // 2. 当天没有 → 调外部 API 拉取并缓存
    const fetched = await this.fetchAndSave(date, fromCurrency, toCurrency);
    if (fetched) return fetched;

    // 3. API 也失败 → 取 <= date 的最近一条
    const closest = await this.rateRepo
      .createQueryBuilder('r')
      .where('r.fromCurrency = :fromCurrency', { fromCurrency })
      .andWhere('r.toCurrency = :toCurrency', { toCurrency })
      .andWhere('r.effectiveDate <= :date', { date })
      .orderBy('r.effectiveDate', 'DESC')
      .getOne();

    if (closest) {
      this.logger.warn(
        `外部API获取汇率失败，使用 ${closest.effectiveDate} 的历史汇率 ${closest.rate}`,
      );
      return closest.rate;
    }

    // 4. 兜底：取该币种最新一条
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

    throw new Error(
      `未找到 ${fromCurrency}→${toCurrency} 的汇率数据，请先在汇率管理中维护`,
    );
  }

  /**
   * 从 Frankfurter API 拉取指定日期汇率并存入 exchange_rate 表
   * @returns 汇率字符串，失败返回 null
   */
  private async fetchAndSave(
    date: string,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<string | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get('https://api.frankfurter.dev/v2/rates', {
          params: { date, base: fromCurrency, quotes: toCurrency },
        }),
      );

      if (data && data[0] && data[0].rate) {
        const rateValue = String(data[0].rate);
        const effectiveDate = data[0].date || date;

        // 检查该日期是否已有记录（API 可能返回前一工作日）
        const existing = await this.rateRepo.findOne({
          where: {
            fromCurrency,
            toCurrency,
            effectiveDate,
          },
        });

        if (!existing) {
          await this.rateRepo.save(
            this.rateRepo.create({
              id: snowflake.nextId(),
              fromCurrency,
              toCurrency,
              rate: rateValue,
              effectiveDate,
            }),
          );
          this.logger.log(
            `自动获取汇率: ${fromCurrency}→${toCurrency} ${effectiveDate} = ${rateValue}`,
          );
        }

        return rateValue;
      }
    } catch (err) {
      this.logger.warn(
        `从外部API获取 ${fromCurrency}→${toCurrency} ${date} 汇率失败: ${(err as Error).message}`,
      );
    }
    return null;
  }
}
