import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Inventory } from '../entities/inventory.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { SystemConfigService } from '@/modules/system-config/system-config.service';
import { MailService } from '@/common/mail/mail.service';

/** 库存变动项（仅减少方向） */
export interface StockDecreaseItem {
	productId: string;
	productModelId: string | null;
	/** 本次减少的数量（正数） */
	decreasedQty: number;
}

/** 触发预警的条目 */
interface AlertEntry {
	productName: string;
	modelName: string | null;
	available: number;
	threshold: number;
}

/**
 * 库存预警邮件通知服务
 *
 * 核心逻辑：crossing 检测 —— 仅当本次扣减使库存从「高于阈值」降至「等于或低于阈值」时触发通知。
 * 天然满足"首次到达"语义：已处于阈值以下的再次扣减不会重复通知；
 * 库存恢复后再次降下来会自然再次触发（无需额外标记字段）。
 *
 * 设计原则：
 * - 一次业务操作涉及多个商品到达阈值 → 合并为一封邮件
 * - 邮件发送失败仅记日志，绝不影响业务流程
 * - 开关关闭或未配置邮箱时直接跳过
 */
@Injectable()
export class StockAlertService {
	private readonly logger = new Logger(StockAlertService.name);

	constructor(
		@InjectRepository(Inventory)
		private readonly inventoryRepo: Repository<Inventory>,
		@InjectRepository(Product)
		private readonly productRepo: Repository<Product>,
		@InjectRepository(ProductModel)
		private readonly productModelRepo: Repository<ProductModel>,
		private readonly systemConfigService: SystemConfigService,
		private readonly mailService: MailService,
	) {}

	/**
	 * 检查库存扣减是否触发预警并发送邮件通知
	 * 调用方式：事务提交后 fire-and-forget（void this.stockAlertService.checkAndNotify(items)）
	 */
	async checkAndNotify(items: StockDecreaseItem[]): Promise<void> {
		try {
			if (!items.length) return;

			// 1. 读取开关和邮箱配置
			const enabled = await this.systemConfigService.getByKey(
				'STOCK_ALERT_EMAIL_ENABLED',
			);
			if (enabled !== 'true') return;

			const emailsRaw = await this.systemConfigService.getByKey(
				'STOCK_ALERT_EMAILS',
			);
			const emails = this.parseEmails(emailsRaw);
			if (!emails.length) return;

			// 2. 获取全局预警阈值
			const globalThreshold = await this.getGlobalThreshold();

			// 3. 合并同商品同型号的多次扣减
			const merged = this.mergeItems(items);

			// 4. 逐项做 crossing 检测
			const alerts: AlertEntry[] = [];
			for (const item of merged) {
				const result = await this.checkCrossing(item, globalThreshold);
				if (result) alerts.push(result);
			}

			if (!alerts.length) return;

			// 5. 发送聚合邮件
			const html = this.buildEmailHtml(alerts);
			await this.mailService.sendMail({
				to: emails,
				subject: `【库存预警】${alerts.length} 个商品库存降至预警线以下`,
				html,
			});

			this.logger.log(
				`库存预警邮件已发送至 ${emails.join(', ')}，涉及 ${alerts.length} 个商品`,
			);
		} catch (error) {
			// 邮件通知失败不影响业务流程，仅记录日志
			this.logger.error(
				`库存预警通知失败: ${error instanceof Error ? error.message : error}`,
			);
		}
	}

	/**
	 * 解析邮箱配置（逗号分隔 → 数组，过滤空值和无效格式）
	 */
	private parseEmails(raw: string | null): string[] {
		if (!raw) return [];
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s.length > 0 && s.includes('@'));
	}

	/**
	 * 获取全局库存预警阈值
	 */
	private async getGlobalThreshold(): Promise<number> {
		const val = await this.systemConfigService.getByKey('LOW_STOCK_WARNING');
		return val != null ? parseFloat(val) : 0;
	}

	/**
	 * 合并同商品同型号的扣减项（一次业务操作可能多条明细指向同一库存行）
	 */
	private mergeItems(items: StockDecreaseItem[]): StockDecreaseItem[] {
		const map = new Map<string, StockDecreaseItem>();
		for (const item of items) {
			const key = `${item.productId}__${item.productModelId || 'NULL'}`;
			const existing = map.get(key);
			if (existing) {
				existing.decreasedQty += item.decreasedQty;
			} else {
				map.set(key, { ...item });
			}
		}
		return [...map.values()];
	}

	/**
	 * 对单个库存行做 crossing 检测
	 * 返回 AlertEntry 表示触发了预警，返回 null 表示未触发
	 */
	private async checkCrossing(
		item: StockDecreaseItem,
		globalThreshold: number,
	): Promise<AlertEntry | null> {
		// 查询当前库存
		const where = item.productModelId
			? { productId: item.productId, productModelId: item.productModelId }
			: { productId: item.productId, productModelId: IsNull() };
		const inventory = await this.inventoryRepo.findOne({ where });
		if (!inventory) return null;

		const currentAvailable = parseFloat(inventory.availableQuantity);

		// 确定有效阈值（型号级优先，NULL 则取全局；负数表示不预警）
		const threshold = await this.resolveThreshold(
			item.productId,
			item.productModelId,
			globalThreshold,
		);
		if (threshold === null) return null; // 负数阈值 → 跳过

		// crossing 判定：扣减前 > 阈值，扣减后 <= 阈值
		const beforeAvailable = currentAvailable + item.decreasedQty;
		if (beforeAvailable > threshold && currentAvailable <= threshold) {
			// 查询商品/型号名称用于邮件内容
			const { productName, modelName } = await this.getProductInfo(
				item.productId,
				item.productModelId,
			);
			return {
				productName,
				modelName,
				available: currentAvailable,
				threshold,
			};
		}

		return null;
	}

	/**
	 * 确定有效预警阈值
	 * 优先级：型号 minimumStock（非 NULL）> 全局 LOW_STOCK_WARNING
	 * 负数阈值表示该商品/型号不参与预警 → 返回 null
	 * 停用商品、停用/已删除型号不参与预警 → 返回 null
	 */
	private async resolveThreshold(
		productId: string,
		productModelId: string | null,
		globalThreshold: number,
	): Promise<number | null> {
		// 校验商品状态
		const product = await this.productRepo.findOne({
			where: { id: productId },
		});
		if (!product || product.status !== 1) return null;

		if (productModelId) {
			const model = await this.productModelRepo.findOne({
				where: { id: productModelId },
			});
			// 停用或已删除型号不参与预警
			if (!model || model.status !== 1 || model.isDeleted !== 0) return null;
			// 型号级阈值优先
			if (model.minimumStock != null) {
				const val = parseFloat(model.minimumStock);
				return val < 0 ? null : val;
			}
		}

		// 全局阈值
		return globalThreshold < 0 ? null : globalThreshold;
	}

	/**
	 * 获取商品和型号名称（用于邮件展示）
	 */
	private async getProductInfo(
		productId: string,
		productModelId: string | null,
	): Promise<{ productName: string; modelName: string | null }> {
		const product = await this.productRepo.findOne({
			where: { id: productId },
		});
		const productName = product?.productName || productId;

		let modelName: string | null = null;
		if (productModelId) {
			const model = await this.productModelRepo.findOne({
				where: { id: productModelId },
			});
			modelName = model?.modelName || null;
		}

		return { productName, modelName };
	}

	/**
	 * 构建预警邮件 HTML（简约美观风格）
	 */
	private buildEmailHtml(alerts: AlertEntry[]): string {
		const time = new Date().toLocaleString('zh-CN', {
			timeZone: 'Asia/Shanghai',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		});

		const rows = alerts
			.map(
				(a) => `
			<tr>
				<td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;color:#333;">${a.productName}</td>
				<td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;color:#333;">${a.modelName || '—'}</td>
				<td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;color:#e65100;font-weight:600;">${a.available}</td>
				<td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;color:#666;">${a.threshold}</td>
			</tr>`,
			)
			.join('');

		return `
<div style="max-width:640px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
	<div style="background:#fff7e6;border-left:4px solid #fa8c16;padding:16px 20px;border-radius:4px;margin-bottom:20px;">
		<p style="margin:0;font-size:15px;color:#d46b08;font-weight:600;">库存预警通知</p>
		<p style="margin:6px 0 0;font-size:13px;color:#8c6d3f;">以下商品库存已降至预警阈值以下，请及时补货。</p>
	</div>
	<table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
		<thead>
			<tr style="background:#fafafa;">
				<th style="padding:10px 16px;text-align:left;color:#666;font-weight:500;border-bottom:1px solid #f0f0f0;">商品名称</th>
				<th style="padding:10px 16px;text-align:left;color:#666;font-weight:500;border-bottom:1px solid #f0f0f0;">型号</th>
				<th style="padding:10px 16px;text-align:left;color:#666;font-weight:500;border-bottom:1px solid #f0f0f0;">当前可用库存</th>
				<th style="padding:10px 16px;text-align:left;color:#666;font-weight:500;border-bottom:1px solid #f0f0f0;">预警阈值</th>
			</tr>
		</thead>
		<tbody>${rows}
		</tbody>
	</table>
	<p style="margin-top:16px;font-size:12px;color:#999;">通知时间：${time}｜此邮件由系统自动发送，请勿直接回复</p>
</div>`;
	}
}
