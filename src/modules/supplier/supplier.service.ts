import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';
import { SequenceService } from '@/common/services/sequence.service';

@Injectable()
export class SupplierService extends BaseCrudService<Supplier> {
  constructor(
    @InjectRepository(Supplier)
    repo: Repository<Supplier>,
    private readonly sequenceService: SequenceService,
  ) {
    super(repo, 'supplier');
  }

  /** 覆写 create：自动生成 GYS 前缀的供应商编号 */
  async create(data: object): Promise<Supplier> {
    const supplierNo = await this.sequenceService.generate('GYS');
    return super.create({ supplierNo, ...data } as DeepPartial<Supplier>);
  }

  protected getSearchFields(): string[] {
    return ['supplierNo', 'supplierName', 'contactName'];
  }
}
