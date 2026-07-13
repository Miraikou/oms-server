import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { RateService } from './rate.service';
import { ExchangeRate } from '@/modules/rate/entities/exchange-rate.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExchangeRate]),
    HttpModule,
  ],
  providers: [RateService],
  exports: [RateService],
})
export class RateModule {}
