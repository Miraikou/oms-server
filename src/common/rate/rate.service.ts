import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class RateService {
	private readonly logger = new Logger(RateService.name);

	/** 默认汇率（USD → CNY），对接真实 API 前使用 */
	private readonly defaultRates: Record<string, number> = {
		USD: 6.8,
	};

	constructor(private readonly httpService: HttpService) {}

	async getRate(params: { date: string; base: string; quotes?: string }) {
		if (!params.quotes) {
			params.quotes = 'CNY';
		}

		try {
			const { data } = await firstValueFrom(
				this.httpService.get('https://api.frankfurter.dev/v2/rates', {
					params,
				}),
			);
			return data[0];
		} catch {
			this.logger.warn('汇率 API 不可用，使用默认汇率 USD → CNY = 6.8');
			return {
				...params,
				rate: this.defaultRates[params.base] ?? 1,
        isDefault: true,
			};
		}
	}
}
