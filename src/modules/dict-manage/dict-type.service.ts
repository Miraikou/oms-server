import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysDictType } from './entities/sys-dict-type.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

/**
 * 字典类型 CRUD 服务
 */
@Injectable()
export class DictTypeService extends BaseCrudService<SysDictType> {
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
}
