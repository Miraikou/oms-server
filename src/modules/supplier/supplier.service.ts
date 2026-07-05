import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

@Injectable()
export class SupplierService extends BaseCrudService<Supplier> {
  constructor(
    @InjectRepository(Supplier)
    repo: Repository<Supplier>,
  ) {
    super(repo, 'supplier');
  }

  protected getSearchFields(): string[] {
    return ['supplierName', 'contactName'];
  }
}
