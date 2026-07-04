import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ExpressCompany } from './entities/express-company.entity'
import { BaseCrudService } from '@/common/services/base-crud.service'

@Injectable()
export class ExpressCompanyService extends BaseCrudService<ExpressCompany> {
  constructor(@InjectRepository(ExpressCompany) repo: Repository<ExpressCompany>) {
    super(repo, 'ec')
  }
  protected getSearchFields(): string[] {
    return ['companyName']
  }
}
