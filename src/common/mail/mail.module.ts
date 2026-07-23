import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { SystemConfigModule } from '@/modules/system-config/system-config.module';
import { MailService } from './mail.service';
import { ExchangeRate } from '@/modules/rate/entities/exchange-rate.entity';

@Module({
	imports: [
		TypeOrmModule.forFeature([ExchangeRate]),
		HttpModule,
		SystemConfigModule,
	],
	providers: [MailService],
	exports: [MailService],
})
export class MailModule {}
