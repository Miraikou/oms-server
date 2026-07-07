import { Module } from '@nestjs/common';
import { RateController } from './rate.controller';
import { RateModule as CommonRateModule } from '@/common/rate/rate.module';

@Module({
  imports: [CommonRateModule],
  controllers: [RateController],
})
export class RateModule {}
