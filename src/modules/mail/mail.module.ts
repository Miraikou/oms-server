import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailModule as CommonMailModule } from '@/common/mail/mail.module';

@Module({
	imports: [CommonMailModule],
	controllers: [MailController],
	providers: [MailService],
})
export class MailModule {}
