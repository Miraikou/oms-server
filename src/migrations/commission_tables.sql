-- ============================================================
-- 提成模块数据库建表 SQL
-- ============================================================

-- 提成分录表：每笔收款/退款生成一条记录
CREATE TABLE IF NOT EXISTS `commission_ledger` (
  `id` bigint NOT NULL,
  `salesperson_id` bigint NOT NULL COMMENT '销售员 ID',
  `sales_order_id` bigint NOT NULL COMMENT '关联销售订单',
  `payment_id` bigint DEFAULT NULL COMMENT '关联收款/退款记录',
  `sales_return_id` bigint DEFAULT NULL COMMENT '关联退货记录（退款场景）',
  
  `type` tinyint NOT NULL COMMENT '类型：1=计提 2=冲回',
  `status` tinyint NOT NULL DEFAULT 1 COMMENT '状态：1=待结算 2=已结算',
  
  `order_amount` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '订单原始金额',
  `received_amount` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '本次收/退款金额（原币）',
  `received_base_amount` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '本次收/退款金额（CNY）',
  `commission_rate` decimal(8,4) NOT NULL COMMENT '提成比例快照（%）',
  `commission_amount` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '提成金额（原币，冲回时为负数）',
  `commission_base_amount` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '提成金额（CNY，正数=计提，负数=冲回）',
  
  `currency` varchar(10) NOT NULL DEFAULT 'USD' COMMENT '原币币种',
  `exchange_rate` decimal(18,4) NOT NULL DEFAULT 1.0000 COMMENT '汇率',
  
  `settle_month` varchar(7) DEFAULT NULL COMMENT '结算月份 YYYY-MM',
  `settle_time` datetime DEFAULT NULL COMMENT '结算时间',
  
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `created_by` bigint DEFAULT NULL COMMENT '创建人ID',
  `created_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_by` bigint DEFAULT NULL COMMENT '修改人ID',
  `updated_time` datetime(6) DEFAULT NULL COMMENT '修改时间',
  
  PRIMARY KEY (`id`),
  KEY `idx_salesperson_id` (`salesperson_id`),
  KEY `idx_sales_order_id` (`sales_order_id`),
  KEY `idx_payment_id` (`payment_id`),
  KEY `idx_settle_month` (`settle_month`),
  KEY `idx_type_status` (`type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='提成分录表';


-- 提成月度结算表：按月汇总每个销售员的净提成
CREATE TABLE IF NOT EXISTS `commission_settlement` (
  `id` bigint NOT NULL,
  `salesperson_id` bigint NOT NULL COMMENT '销售员 ID',
  `settle_month` varchar(7) NOT NULL COMMENT '结算月份 YYYY-MM',
  
  `total_earned` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '当月计提总额（CNY）',
  `total_clawback` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '当月冲回总额（CNY，正数）',
  `previous_balance` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '上月结余（CNY，负数表示欠款）',
  `net_commission` decimal(18,2) NOT NULL DEFAULT 0.00 COMMENT '净提成 = earned - clawback + previousBalance',
  
  `order_count` int NOT NULL DEFAULT 0 COMMENT '涉及订单数',
  `clawback_count` int NOT NULL DEFAULT 0 COMMENT '冲回笔数',
  
  `status` tinyint NOT NULL DEFAULT 1 COMMENT '状态：1=待确认 2=已发放 3=已取消',
  `paid_amount` decimal(18,2) DEFAULT 0.00 COMMENT '实际发放金额',
  `paid_time` datetime DEFAULT NULL COMMENT '发放时间',
  
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `created_by` bigint DEFAULT NULL COMMENT '创建人ID',
  `created_time` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  `updated_by` bigint DEFAULT NULL COMMENT '修改人ID',
  `updated_time` datetime(6) DEFAULT NULL COMMENT '修改时间',
  
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_salesperson_month` (`salesperson_id`, `settle_month`),
  KEY `idx_settle_month` (`settle_month`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='提成月度结算表';
