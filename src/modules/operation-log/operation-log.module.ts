import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysOperationLog } from './entities/sys-operation-log.entity';
import { OperationLogController } from './operation-log.controller';
import { OperationLogService } from './operation-log.service';

/**
 * 操作日志模块
 * 全局模块，供所有业务模块注入使用
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SysOperationLog])],
  controllers: [OperationLogController],
  providers: [OperationLogService],
  exports: [OperationLogService],
})
export class OperationLogModule {}
