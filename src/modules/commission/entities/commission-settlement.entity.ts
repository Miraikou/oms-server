import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * 提成月度结算实体 ⭐
 * 按月汇总每个销售员的净提成，用于发放
 * UNIQUE KEY (salesperson_id, settle_month)
 */
@Entity('commission_settlement')
@Index('uk_salesperson_month', ['salespersonId', 'settleMonth'], {
	unique: true,
})
export class CommissionSettlement extends BaseEntity {
	@Index('idx_salesperson_id')
	@Column({
		name: 'salesperson_id',
		type: 'bigint',
		comment: '销售员 ID',
	})
	salespersonId: string;

	@Index('idx_settle_month')
	@Column({
		name: 'settle_month',
		type: 'varchar',
		length: 7,
		comment: '结算月份 YYYY-MM',
	})
	settleMonth: string;

	@Column({
		name: 'total_earned',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '当月计提总额（CNY）',
	})
	totalEarned: string = '0';

	@Column({
		name: 'total_clawback',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '当月冲回总额（CNY，正数）',
	})
	totalClawback: string = '0';

	@Column({
		name: 'previous_balance',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '上月结余（CNY，负数表示欠款）',
	})
	previousBalance: string = '0';

	@Column({
		name: 'net_commission',
		type: 'decimal',
		precision: 18,
		scale: 2,
		default: 0,
		comment: '净提成 = earned - clawback + previousBalance',
	})
	netCommission: string = '0';

	@Column({
		name: 'order_count',
		type: 'int',
		default: 0,
		comment: '涉及订单数',
	})
	orderCount: number = 0;

	@Column({
		name: 'clawback_count',
		type: 'int',
		default: 0,
		comment: '冲回笔数',
	})
	clawbackCount: number = 0;

	@Column({
		type: 'tinyint',
		default: 1,
		comment: '状态：1=待确认 2=已发放 3=已取消',
	})
	status: number = 1;

	@Column({
		name: 'paid_amount',
		type: 'decimal',
		precision: 18,
		scale: 2,
		nullable: true,
		default: 0,
		comment: '实际发放金额',
	})
	paidAmount: string | null = '0';

	@Column({
		name: 'paid_time',
		type: 'datetime',
		nullable: true,
		comment: '发放时间',
	})
	paidTime: Date | null = null;
}
