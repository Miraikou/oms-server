import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysDictType } from './entities/sys-dict-type.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

/**
 * 字典类型 CRUD 服务
 */
@Injectable()
export class DictTypeService extends BaseCrudService<SysDictType> {
  private readonly logger = new Logger(DictTypeService.name);

  constructor(@InjectRepository(SysDictType) repo: Repository<SysDictType>) {
    super(repo, 'dt');
  }

  protected getSearchFields(): string[] {
    return ['typeCode', 'typeName'];
  }

  protected getUpdatableFields(): string[] {
    return ['typeName', 'status', 'remark'];
  }

  protected getNullableFields(): string[] {
    return ['remark'];
  }

  /**
   * 初始化默认字典类型（字典项留空，后续通过管理界面维护）
   */
  async seedDictTypes(): Promise<void> {
    const defaultTypes = [
      { typeCode: 'PAYMENT_METHOD', typeName: '支付方式' },
      { typeCode: 'TRADE_TYPE', typeName: '交易方式' },
    ];

    for (const item of defaultTypes) {
      const exists = await this.repo.findOne({ where: { typeCode: item.typeCode } });
      if (!exists) {
        await this.repo.save(this.repo.create(item));
        this.logger.log(`已创建字典类型: ${item.typeCode} - ${item.typeName}`);
      }
    }
  }
}
