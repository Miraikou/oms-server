import { Controller, Post, Body } from '@nestjs/common';
import { MailService } from './mail.service';
import { SendMailDto } from './dto/send-mail.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('邮件服务')
@Controller('mail')
export class MailController {
	constructor(private readonly mailService: MailService) {}

	@Post('send')
	@ApiOperation({
		summary: '发送邮件',
		description: '通过配置的 SMTP 服务发送邮件',
	})
	send(@Body() sendMailDto: SendMailDto) {
		return this.mailService.send(sendMailDto);
	}
}
