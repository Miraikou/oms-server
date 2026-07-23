import { Injectable } from '@nestjs/common';
import { SendMailDto } from './dto/send-mail.dto';
import { MailService as CommonMailService } from '@/common/mail/mail.service';

@Injectable()
export class MailService {
	constructor(private readonly commonMailService: CommonMailService) {}

	async send(sendMailDto: SendMailDto) {
		return this.commonMailService.sendMail(sendMailDto);
	}
}
