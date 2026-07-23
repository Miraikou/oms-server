import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
	private readonly logger = new Logger(MailService.name);
	private transporter: Transporter | null = null;
	private initPromise: Promise<Transporter> | null = null;

	constructor(private readonly configService: ConfigService) {}

	/**
	 * 获取或创建邮件传输器（单例，懒加载）
	 */
	private async getTransporter(): Promise<Transporter> {
		if (this.transporter) return this.transporter;
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			const host = await this.configService.get('SMTP_HOST');
			const port = parseInt(
				(await this.configService.get('SMTP_PORT')) || '465',
				10,
			);
			const user = await this.configService.get('SMTP_USER');
			const pass = await this.configService.get('SMTP_PASS');
			
			const secure =
				(await this.configService.get('SMTP_SECURE')) ===
				'true';

			if (!host || !user || !pass) {
				throw new Error(
					'邮件服务配置不完整，请检查 SMTP_HOST、SMTP_USER、SMTP_PASS',
				);
			}

			this.transporter = nodemailer.createTransport({
				host,
				port,
				secure,
				auth: { user, pass },
			});

			await this.transporter.verify();
			this.logger.log('邮件传输器初始化成功');
			return this.transporter;
		})();

		return this.initPromise;
	}

	/**
	 * 发送邮件
	 * @param options.to - 收件人邮箱（支持多个，用逗号分隔）
	 * @param options.subject - 邮件主题
	 * @param options.text - 纯文本内容（与 html 二选一或都提供）
	 * @param options.html - HTML 内容
	 * @param options.from - 发件人地址（可选，默认从 SMTP_FROM 配置读取）
	 * @param options.attachments - 附件数组（可选）
	 */
	async sendMail(options: {
		to: string | string[];
		subject: string;
		text?: string;
		html?: string;
		from?: string;
		attachments?: Array<{
			filename: string;
			content?: string | Buffer;
			path?: string;
			contentType?: string;
		}>;
	}): Promise<void> {
		const transporter = await this.getTransporter();

		// 发件人地址：优先使用传入的，否则从系统配置读取
		let from: string | null | undefined = options.from;
		if (!from) {
			from = await this.configService.get('SMTP_FROM');
			if (!from) {
				from = `"跨境订单管理系统" <${from}>`;
			}
		}

		const mailOptions = {
			from,
			to: Array.isArray(options.to) ? options.to.join(',') : options.to,
			subject: options.subject,
			text: options.text,
			html: options.html,
			attachments: options.attachments,
		};

		try {
			const info = await transporter.sendMail(mailOptions);
			this.logger.log(
				`邮件发送成功 [${info.messageId}] 至 ${mailOptions.to}`,
			);
		} catch (error) {
			this.logger.error(
				`邮件发送失败: ${error instanceof Error ? error.message : error}`,
			);
			throw new Error(
				`邮件发送失败: ${error instanceof Error ? error.message : error}`,
			);
		}
	}
}
