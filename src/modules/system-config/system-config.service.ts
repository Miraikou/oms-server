import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

@Injectable()
export class SystemConfigService extends BaseCrudService<SystemConfig> {
  constructor(@InjectRepository(SystemConfig) repo: Repository<SystemConfig>) {
    super(repo, 'sc');
  }

  protected getSearchFields(): string[] {
    return ['configKey', 'configName'];
  }

  protected getUpdatableFields(): string[] {
    return ['configValue', 'configName', 'valueType', 'remark'];
  }

  protected getNullableFields(): string[] {
    return ['remark'];
  }

  /** 根据 key 获取配置值 */
  async getByKey(key: string): Promise<string | null> {
    const config = await this.repo.findOne({ where: { configKey: key } });
    return config?.configValue || null;
  }

  /** 根据 key 更新配置值 */
  async updateByKey(key: string, value: string): Promise<SystemConfig> {
    const config = await this.repo.findOne({ where: { configKey: key } });
    if (!config) {
      throw new NotFoundException(`配置项 ${key} 不存在`);
    }
    config.configValue = value;
    return this.repo.save(config);
  }

  /** 获取所有配置（key-value 对象形式） */
  async getAllAsMap(): Promise<Record<string, string>> {
    const configs = await this.repo.find();
    const map: Record<string, string> = {};
    for (const c of configs) {
      map[c.configKey] = c.configValue;
    }
    return map;
  }
}
