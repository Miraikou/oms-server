import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysSequence } from '@/common/entities/sys-sequence.entity';
import { SequenceService } from './sequence.service';

/**
 * 编号生成全局模块
 * 提供 SequenceService，所有业务模块可直接注入使用
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SysSequence])],
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}
