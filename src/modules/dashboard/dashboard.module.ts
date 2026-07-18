import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { RateModule as CommonRateModule } from '@/common/rate/rate.module';
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity';

/**
 * 驾驶舱模块
 * 使用原生 SQL 聚合查询，仅注册 Salesperson 实体（用于身份解析）
 */
@Module({
  imports: [CommonRateModule, TypeOrmModule.forFeature([Salesperson])],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
