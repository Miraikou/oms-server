import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DeepPartial } from 'typeorm';
import { CommonContact } from './entities/common-contact.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';
import { snowflake } from '@/common/utils/snowflake';

@Injectable()
export class CommonContactService extends BaseCrudService<CommonContact> {
  constructor(
    @InjectRepository(CommonContact) repo: Repository<CommonContact>,
  ) {
    super(repo, 'cc');
  }

  protected getSearchFields(): string[] {
    return ['contactName'];
  }

  /** 记录使用（创建订单时调用） */
  async recordUsage(contactName: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { contactName } });
    if (existing) {
      existing.usageCount += 1;
      existing.lastUsedTime = new Date();
      await this.repo.save(existing);
    } else {
      const newContact = this.repo.create({
        id: snowflake.nextId(),
        contactName,
        usageCount: 1,
        lastUsedTime: new Date(),
      } as DeepPartial<CommonContact>);
      await this.repo.save(newContact);
    }
  }

  /** 按使用频率排序获取 */
  async findByUsage(limit = 20): Promise<CommonContact[]> {
    return this.repo
      .createQueryBuilder('cc')
      .orderBy('cc.usageCount', 'DESC')
      .addOrderBy('cc.lastUsedTime', 'DESC')
      .take(limit)
      .getMany();
  }
}
