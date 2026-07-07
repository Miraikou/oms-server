import { Module } from '@nestjs/common';
import { RateService } from './rate.service';
import { HttpModule } from '@nestjs/axios';

@Module({
	imports: [HttpModule],
	providers: [RateService],
	exports: [RateService],
})
export class RateModule {}
