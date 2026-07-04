import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Salesperson } from './entities/salesperson.entity'
import { BaseCrudService } from '@/common/services/base-crud.service'

@Injectable()
export class SalespersonService extends BaseCrudService<Salesperson> {
  constructor(@InjectRepository(Salesperson) repo: Repository<Salesperson>) {
    super(repo, 'sp')
  }

  protected getSearchFields(): string[] {
    return ['name', 'phone']
  }
}
