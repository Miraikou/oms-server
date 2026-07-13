import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransportChannel } from './entities/transport-channel.entity';
import { BaseCrudService } from '@/common/services/base-crud.service';

@Injectable()
export class TransportChannelService extends BaseCrudService<TransportChannel> {
  constructor(
    @InjectRepository(TransportChannel) repo: Repository<TransportChannel>,
  ) {
    super(repo, 'tc');
  }
  protected getSearchFields(): string[] {
    return ['channelName'];
  }

  protected getUpdatableFields(): string[] {
    return ['channelName', 'status', 'remark'];
  }

  protected getNullableFields(): string[] {
    return ['remark'];
  }
}
