import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { SystemConfigModule } from '@/modules/system-config/system-config.module';
import { RateService } from './rate.service';
import { ExchangeRate } from '@/modules/rate/entities/exchange-rate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExchangeRate]),
    HttpModule,
    SystemConfigModule,
  ],
  providers: [RateService],
  exports: [RateService],
})
export class RateModule {}
