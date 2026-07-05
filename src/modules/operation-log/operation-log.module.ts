import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysOperationLog } from './entities/sys-operation-log.entity';
import { OperationLogController } from './operation-log.controller';
import { OperationLogService } from './operation-log.service';
import { OperationLogInterceptor } from '@/common/interceptors/operation-log.interceptor';

/**
 * 操作日志模块
 * 全局模块，自动拦截所有写操作（POST/PUT/DELETE）并记录操作日志
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SysOperationLog])],
  controllers: [OperationLogController],
  providers: [
    OperationLogService,
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationLogInterceptor,
    },
  ],
  exports: [OperationLogService],
})
export class OperationLogModule {}
