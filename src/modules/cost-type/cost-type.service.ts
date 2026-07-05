import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CostType } from './entities/cost-type.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

@Injectable()
export class CostTypeService extends BaseCrudService<CostType> {
  constructor(@InjectRepository(CostType) repo: Repository<CostType>) {
    super(repo, 'ct');
  }
  protected getSearchFields(): string[] {
    return ['costName'];
  }
}
