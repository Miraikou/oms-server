import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { RateModule as CommonRateModule } from '@/common/rate/rate.module';

/**
 * 驾驶舱模块
 * 使用原生 SQL 聚合查询，无需注册实体
 */
@Module({
  imports: [CommonRateModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
