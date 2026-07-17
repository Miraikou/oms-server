import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 提成分录实体
 * 每笔收款/退款生成一条记录，形成完整提成流水
 * type=1 计提（收款时），type=2 冲回（退款时）
 */
@Entity('commission_ledger')
export class CommissionLedger extends BaseEntity {
	@Index('idx_salesperson_id')
	@Column({
		name: 'salesperson_id',
		type: 'bigint',
		comment: '销售员 ID',
	})
	salespersonId: string;

	@Index('idx_sales_order_id')
	@Column({
		name: 'sales_order_id',
		type: 'bigint',
		comment: '关联销售订单',
	})
	salesOrderId: string;

	@Index('idx_payment_id')
	@Column({
		name: 'payment_id',
		type: 'bigint',
		nullable: true,
		comment: '关联收款/退款记录',
	})
	paymentId: string | null = null;

	@Column({
		name: 'sales_return_id',
		type: 'bigint',
		nullable: true,
		comment: '关联退货记录（退款场景）',
	})
	salesReturnId: string | null = null;

	@Column({ type: 'tinyint', comment: '类型：1=计提 2=冲回' })
	type: number;

	@Index('idx_type_status')
	@Column({
		type: 'tinyint',
		default: 1,
		comment: '状态：1=待结算 2=已结算',
	})
	status: number = 1;

	@Column({
		name: 'order_amount_usd',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '订单原始金额（USD）',
	})
	orderAmountUsd: string = '0';

	@Column({
		name: 'order_amount_cny',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '订单原始金额（CNY）',
	})
	orderAmountCny: string = '0';

	@Column({
		name: 'received_amount_usd',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '本次收/退款金额（USD）',
	})
	receivedAmountUsd: string = '0';

	@Column({
		name: 'received_amount_cny',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '本次收/退款金额（CNY）',
	})
	receivedAmountCny: string = '0';

	@Column({
		name: 'commission_rate',
		type: 'decimal',
		precision: 8,
		scale: 4,
		comment: '提成比例快照（%）',
	})
	commissionRate: string;

	@Column({
		name: 'commission_amount_usd',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '提成金额（USD，冲回时为负数）',
	})
	commissionAmountUsd: string = '0';

	@Column({
		name: 'commission_amount_cny',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '提成金额（CNY，正数=计提，负数=冲回）',
	})
	commissionAmountCny: string = '0';

	@Column({
		name: 'currency',
		type: 'varchar',
		length: 10,
		default: 'USD',
		comment: '原币币种',
	})
	currency: string = 'USD';

	@Column({
		name: 'exchange_rate',
		type: 'decimal',
		precision: 18,
		scale: 4,
		default: 7.0,
		comment: 'USD→CNY汇率',
	})
	exchangeRate: string = '7.0000';

	@Index('idx_settle_month')
	@Column({
		name: 'settle_month',
		type: 'varchar',
		length: 7,
		nullable: true,
		comment: '结算月份 YYYY-MM',
	})
	settleMonth: string | null = null;

	@Column({
		name: 'settle_time',
		type: 'datetime',
		nullable: true,
		comment: '结算时间',
	})
	settleTime: Date | null = null;
}
