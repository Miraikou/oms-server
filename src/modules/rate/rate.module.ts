import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { RateController } from './rate.controller';
import { ExchangeRateService } from './exchange-rate.service';
import { ExchangeRate } from './entities/exchange-rate.entity';
import { RateModule as CommonRateModule } from '@/common/rate/rate.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExchangeRate]),
    HttpModule,
    CommonRateModule,
  ],
  controllers: [RateController],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class RateModule {}
