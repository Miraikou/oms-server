-- ============================================================
-- 双币种改造迁移脚本
-- 目标：所有金额列统一为 xxx_usd + xxx_cny 双列模式
-- exchange_rate 含义统一为 USD→CNY
-- ============================================================
-- 执行顺序：先停服务 → 跑本脚本 → 改代码 → 重启
-- ============================================================

-- ============================================================
-- 0. 修复 CNY 订单/记录的 exchange_rate
--    CNY 订单当前 exchange_rate=1（CNY→CNY），需改为 USD→CNY
-- ============================================================

-- sales_order: CNY 订单修正汇率
UPDATE sales_order so
LEFT JOIN exchange_rate er ON er.from_currency = 'USD'
  AND er.to_currency = 'CNY'
  AND er.effective_date = (
    SELECT MAX(e2.effective_date) FROM exchange_rate e2
    WHERE e2.from_currency = 'USD' AND e2.to_currency = 'CNY'
    AND e2.effective_date <= so.order_date
  )
SET so.exchange_rate = COALESCE(er.rate, 7.0)
WHERE so.currency = 'CNY' AND so.exchange_rate = 1;

-- purchase_order: CNY 订单修正汇率
UPDATE purchase_order po
LEFT JOIN exchange_rate er ON er.from_currency = 'USD'
  AND er.to_currency = 'CNY'
  AND er.effective_date = (
    SELECT MAX(e2.effective_date) FROM exchange_rate e2
    WHERE e2.from_currency = 'USD' AND e2.to_currency = 'CNY'
    AND e2.effective_date <= po.purchase_date
  )
SET po.exchange_rate = COALESCE(er.rate, 7.0)
WHERE po.currency = 'CNY' AND po.exchange_rate = 1;


-- ============================================================
-- 1. sales_order
-- ============================================================
ALTER TABLE sales_order RENAME COLUMN total_amount TO total_amount_usd;
ALTER TABLE sales_order RENAME COLUMN total_base_amount TO total_amount_cny;
ALTER TABLE sales_order RENAME COLUMN received_amount TO received_amount_usd;
ALTER TABLE sales_order RENAME COLUMN received_base_amount TO received_amount_cny;
ALTER TABLE sales_order RENAME COLUMN blogger_commission_amount TO blogger_commission_amount_usd;
ALTER TABLE sales_order RENAME COLUMN blogger_commission_base_amount TO blogger_commission_amount_cny;
ALTER TABLE sales_order MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT 7.0000 COMMENT 'USD→CNY汇率';

-- 回填：CNY 订单的 xxx_usd 列实际存的是 CNY，需要计算 USD
UPDATE sales_order
SET total_amount_usd = ROUND(total_amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND total_amount_usd != 0 AND exchange_rate > 1;

UPDATE sales_order
SET received_amount_usd = ROUND(received_amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND received_amount_usd != 0 AND exchange_rate > 1;

UPDATE sales_order
SET blogger_commission_amount_usd = ROUND(blogger_commission_amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND blogger_commission_amount_usd != 0 AND exchange_rate > 1;


-- ============================================================
-- 2. sales_order_item
-- ============================================================
ALTER TABLE sales_order_item RENAME COLUMN unit_price TO unit_price_usd;
ALTER TABLE sales_order_item RENAME COLUMN amount TO amount_usd;
ALTER TABLE sales_order_item RENAME COLUMN base_amount TO amount_cny;

ALTER TABLE sales_order_item ADD COLUMN unit_price_cny DECIMAL(18,2) DEFAULT NULL COMMENT '销售单价（CNY）';

-- 回填：USD 订单 → 计算 CNY 单价
UPDATE sales_order_item i
JOIN sales_order so ON so.id = i.order_id
SET i.unit_price_cny = ROUND(i.unit_price_usd * so.exchange_rate, 2)
WHERE i.unit_price_cny IS NULL AND so.currency = 'USD';

-- 回填：CNY 订单 → unit_price_usd 存的是 CNY，需计算 USD 单价，然后交换
UPDATE sales_order_item i
JOIN sales_order so ON so.id = i.order_id
SET i.unit_price_cny = i.unit_price_usd,
    i.unit_price_usd = ROUND(i.unit_price_usd / so.exchange_rate, 2)
WHERE so.currency = 'CNY' AND so.exchange_rate > 1;


-- ============================================================
-- 3. sales_order_cost
-- ============================================================
ALTER TABLE sales_order_cost RENAME COLUMN amount TO amount_usd;
ALTER TABLE sales_order_cost RENAME COLUMN base_amount TO amount_cny;
ALTER TABLE sales_order_cost MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT 1 COMMENT 'USD→CNY汇率';

-- 回填：CNY 成本的 amount_usd 实际存的是 CNY，需交换
UPDATE sales_order_cost
SET amount_usd = ROUND(amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1 AND amount_usd != 0;

-- 回填：USD 成本的 amount_cny 已正确（= amount × rate）
-- 无需操作


-- ============================================================
-- 4. payment
-- ============================================================
ALTER TABLE payment RENAME COLUMN amount TO amount_usd;
ALTER TABLE payment RENAME COLUMN base_amount TO amount_cny;
ALTER TABLE payment MODIFY COLUMN exchange_rate DECIMAL(18,4) COMMENT 'USD→CNY汇率';

-- 回填：CNY 收款的 amount_usd 实际存的是 CNY，需交换
UPDATE payment
SET amount_usd = ROUND(amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1 AND amount_usd != 0;


-- ============================================================
-- 5. purchase_order
-- ============================================================
ALTER TABLE purchase_order RENAME COLUMN total_amount TO total_amount_usd;
ALTER TABLE purchase_order RENAME COLUMN total_base_amount TO total_amount_cny;
ALTER TABLE purchase_order MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT 7.0000 COMMENT 'USD→CNY汇率';

-- 回填：CNY PO 的 total_amount_usd 实际存的是 CNY，需计算 USD
UPDATE purchase_order
SET total_amount_usd = ROUND(total_amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND total_amount_usd != 0 AND exchange_rate > 1;


-- ============================================================
-- 6. purchase_order_item
-- ============================================================
ALTER TABLE purchase_order_item RENAME COLUMN unit_price TO unit_price_usd;
ALTER TABLE purchase_order_item RENAME COLUMN amount TO amount_usd;
ALTER TABLE purchase_order_item RENAME COLUMN base_amount TO amount_cny;

ALTER TABLE purchase_order_item ADD COLUMN unit_price_cny DECIMAL(18,2) DEFAULT NULL COMMENT '采购单价（CNY）';

-- 回填：CNY PO → unit_price_usd 存的是 CNY，需计算 USD + CNY
UPDATE purchase_order_item i
JOIN purchase_order po ON po.id = i.purchase_order_id
SET i.unit_price_cny = i.unit_price_usd,
    i.unit_price_usd = ROUND(i.unit_price_usd / po.exchange_rate, 2)
WHERE po.currency = 'CNY' AND po.exchange_rate > 1;

-- 回填：USD PO → 计算 CNY 单价
UPDATE purchase_order_item i
JOIN purchase_order po ON po.id = i.purchase_order_id
SET i.unit_price_cny = ROUND(i.unit_price_usd * po.exchange_rate, 2)
WHERE po.currency = 'USD' AND i.unit_price_cny IS NULL;


-- ============================================================
-- 7. purchase_receipt_item
-- ============================================================
ALTER TABLE purchase_receipt_item RENAME COLUMN unit_price TO unit_price_usd;
ALTER TABLE purchase_receipt_item RENAME COLUMN amount TO amount_usd;
ALTER TABLE purchase_receipt_item RENAME COLUMN base_amount TO amount_cny;

ALTER TABLE purchase_receipt_item ADD COLUMN unit_price_cny DECIMAL(18,2) DEFAULT NULL COMMENT '入库单价（CNY）';

-- 回填：通过 receipt → PO 获取币种和汇率
UPDATE purchase_receipt_item ri
JOIN purchase_receipt r ON r.id = ri.receipt_id
JOIN purchase_order po ON po.id = r.purchase_order_id
SET ri.unit_price_cny = ri.unit_price_usd,
    ri.unit_price_usd = ROUND(ri.unit_price_usd / po.exchange_rate, 2)
WHERE po.currency = 'CNY' AND po.exchange_rate > 1;

UPDATE purchase_receipt_item ri
JOIN purchase_receipt r ON r.id = ri.receipt_id
JOIN purchase_order po ON po.id = r.purchase_order_id
SET ri.unit_price_cny = ROUND(ri.unit_price_usd * po.exchange_rate, 2)
WHERE po.currency = 'USD' AND ri.unit_price_cny IS NULL;


-- ============================================================
-- 8. shipment_item
-- ============================================================
ALTER TABLE shipment_item RENAME COLUMN sales_unit_price TO sales_unit_price_usd;
ALTER TABLE shipment_item RENAME COLUMN sales_amount TO sales_amount_usd;
ALTER TABLE shipment_item RENAME COLUMN sales_base_amount TO sales_amount_cny;

ALTER TABLE shipment_item ADD COLUMN sales_unit_price_cny DECIMAL(18,2) DEFAULT NULL COMMENT '销售单价（CNY）';
ALTER TABLE shipment_item MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT 7.0000 COMMENT 'USD→CNY汇率';

-- 回填：USD 发货 → 计算 CNY 单价
UPDATE shipment_item
SET sales_unit_price_cny = ROUND(sales_unit_price_usd * exchange_rate, 2)
WHERE currency = 'USD' AND sales_unit_price_cny IS NULL;

-- 回填：CNY 发货 → 交换
UPDATE shipment_item
SET sales_unit_price_cny = sales_unit_price_usd,
    sales_unit_price_usd = ROUND(sales_unit_price_usd / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1;

-- total_cost 和 gross_profit 始终是 CNY，不改


-- ============================================================
-- 9. shipment_item_batch
-- ============================================================
ALTER TABLE shipment_item_batch RENAME COLUMN unit_cost TO unit_cost_usd;
ALTER TABLE shipment_item_batch RENAME COLUMN unit_cost_base TO unit_cost_cny;
ALTER TABLE shipment_item_batch RENAME COLUMN total_cost TO total_cost_usd;
ALTER TABLE shipment_item_batch RENAME COLUMN total_cost_base TO total_cost_cny;
ALTER TABLE shipment_item_batch MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT 1.0000 COMMENT 'USD→CNY汇率';

-- 回填：CNY 批次（默认）→ unit_cost_usd 存的是 CNY，需交换
UPDATE shipment_item_batch
SET unit_cost_usd = ROUND(unit_cost_cny / exchange_rate, 2),
    total_cost_usd = ROUND(total_cost_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1 AND unit_cost_usd != 0;


-- ============================================================
-- 10. inventory_batch
-- ============================================================
ALTER TABLE inventory_batch RENAME COLUMN unit_cost TO unit_cost_usd;
ALTER TABLE inventory_batch RENAME COLUMN unit_cost_base TO unit_cost_cny;
ALTER TABLE inventory_batch MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT 1.0000 COMMENT 'USD→CNY汇率';

-- 回填：CNY 批次 → unit_cost_usd 存的是 CNY，需交换
UPDATE inventory_batch
SET unit_cost_usd = ROUND(unit_cost_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1 AND unit_cost_usd != 0;


-- ============================================================
-- 11. inventory_flow
-- ============================================================
ALTER TABLE inventory_flow RENAME COLUMN unit_cost TO unit_cost_usd;
ALTER TABLE inventory_flow RENAME COLUMN total_cost TO total_cost_usd;
ALTER TABLE inventory_flow RENAME COLUMN total_cost_base TO total_cost_cny;
ALTER TABLE inventory_flow RENAME COLUMN flow_exchange_rate TO exchange_rate;

ALTER TABLE inventory_flow ADD COLUMN unit_cost_cny DECIMAL(18,2) DEFAULT NULL COMMENT '单位成本（CNY）';
ALTER TABLE inventory_flow MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT NULL COMMENT 'USD→CNY汇率';

-- 回填：CNY 流水 → unit_cost_usd/total_cost_usd 存的是 CNY，需交换
UPDATE inventory_flow
SET unit_cost_usd = ROUND(unit_cost_cny / exchange_rate, 2),
    total_cost_usd = ROUND(total_cost_cny / exchange_rate, 2)
WHERE flow_currency = 'CNY' AND exchange_rate > 1 AND unit_cost_usd IS NOT NULL;

-- 回填 unit_cost_cny
UPDATE inventory_flow
SET unit_cost_cny = ROUND(total_cost_cny / quantity, 2)
WHERE unit_cost_cny IS NULL AND total_cost_cny IS NOT NULL AND quantity > 0;


-- ============================================================
-- 12. inventory_adjustment_item
-- ============================================================
ALTER TABLE inventory_adjustment_item RENAME COLUMN unit_price TO unit_price_usd;

ALTER TABLE inventory_adjustment_item ADD COLUMN unit_price_cny DECIMAL(18,4) DEFAULT NULL COMMENT '调整单价（CNY）';
ALTER TABLE inventory_adjustment_item ADD COLUMN exchange_rate DECIMAL(18,4) DEFAULT NULL COMMENT 'USD→CNY汇率';

-- 回填：CNY 调整 → unit_price_usd 存的是 CNY，需计算 USD
UPDATE inventory_adjustment_item i
LEFT JOIN exchange_rate er ON er.from_currency = 'USD'
  AND er.to_currency = 'CNY'
  AND er.effective_date = (
    SELECT MAX(e2.effective_date) FROM exchange_rate e2
    WHERE e2.from_currency = 'USD' AND e2.to_currency = 'CNY'
    AND e2.effective_date <= DATE(i.created_time)
  )
SET i.exchange_rate = COALESCE(er.rate, 7.0),
    i.unit_price_cny = i.unit_price_usd,
    i.unit_price_usd = ROUND(i.unit_price_usd / COALESCE(er.rate, 7.0), 4)
WHERE i.adjust_currency = 'CNY' AND i.unit_price_usd IS NOT NULL;

-- 回填：USD 调整
UPDATE inventory_adjustment_item i
LEFT JOIN exchange_rate er ON er.from_currency = 'USD'
  AND er.to_currency = 'CNY'
  AND er.effective_date = (
    SELECT MAX(e2.effective_date) FROM exchange_rate e2
    WHERE e2.from_currency = 'USD' AND e2.to_currency = 'CNY'
    AND e2.effective_date <= DATE(i.created_time)
  )
SET i.exchange_rate = COALESCE(er.rate, 7.0),
    i.unit_price_cny = ROUND(i.unit_price_usd * COALESCE(er.rate, 7.0), 4)
WHERE i.adjust_currency = 'USD' AND i.unit_price_usd IS NOT NULL;


-- ============================================================
-- 13. sales_return (新增列)
-- ============================================================
ALTER TABLE sales_return ADD COLUMN refund_amount_usd DECIMAL(18,2) DEFAULT NULL COMMENT '退款金额（USD）';
ALTER TABLE sales_return ADD COLUMN refund_amount_cny DECIMAL(18,2) DEFAULT NULL COMMENT '退款金额（CNY）';
ALTER TABLE sales_return ADD COLUMN return_cost_usd DECIMAL(18,2) DEFAULT NULL COMMENT '退货成本（USD）';
ALTER TABLE sales_return ADD COLUMN return_cost_cny DECIMAL(18,2) DEFAULT NULL COMMENT '退货成本（CNY）';
ALTER TABLE sales_return ADD COLUMN exchange_rate DECIMAL(18,4) DEFAULT NULL COMMENT 'USD→CNY汇率';

-- 回填：从关联订单获取汇率
UPDATE sales_return sr
JOIN sales_order so ON so.id = sr.order_id
SET sr.exchange_rate = so.exchange_rate;

-- 回填退款金额
UPDATE sales_return sr
JOIN sales_order so ON so.id = sr.order_id
SET sr.refund_amount_usd = sr.refund_amount,
    sr.refund_amount_cny = ROUND(sr.refund_amount * so.exchange_rate, 2)
WHERE sr.refund_amount IS NOT NULL AND so.currency = 'USD';

UPDATE sales_return sr
JOIN sales_order so ON so.id = sr.order_id
SET sr.refund_amount_cny = sr.refund_amount,
    sr.refund_amount_usd = ROUND(sr.refund_amount / so.exchange_rate, 2)
WHERE sr.refund_amount IS NOT NULL AND so.currency = 'CNY';

-- 回填退货成本
UPDATE sales_return sr
JOIN sales_order so ON so.id = sr.order_id
SET sr.return_cost_usd = ROUND(sr.return_cost / so.exchange_rate, 2),
    sr.return_cost_cny = sr.return_cost
WHERE sr.return_cost IS NOT NULL AND (sr.return_cost_currency = 'CNY' OR sr.return_cost_currency IS NULL);

UPDATE sales_return sr
JOIN sales_order so ON so.id = sr.order_id
SET sr.return_cost_usd = sr.return_cost,
    sr.return_cost_cny = ROUND(sr.return_cost * so.exchange_rate, 2)
WHERE sr.return_cost IS NOT NULL AND sr.return_cost_currency = 'USD';


-- ============================================================
-- 14. commission_ledger
-- ============================================================
ALTER TABLE commission_ledger RENAME COLUMN order_amount TO order_amount_usd;
ALTER TABLE commission_ledger RENAME COLUMN received_amount TO received_amount_usd;
ALTER TABLE commission_ledger RENAME COLUMN received_base_amount TO received_amount_cny;
ALTER TABLE commission_ledger RENAME COLUMN commission_amount TO commission_amount_usd;
ALTER TABLE commission_ledger RENAME COLUMN commission_base_amount TO commission_amount_cny;
ALTER TABLE commission_ledger MODIFY COLUMN exchange_rate DECIMAL(18,4) DEFAULT 1 COMMENT 'USD→CNY汇率';

ALTER TABLE commission_ledger ADD COLUMN order_amount_cny DECIMAL(18,2) DEFAULT NULL COMMENT '订单金额（CNY）';

-- 回填 order_amount_cny
UPDATE commission_ledger
SET order_amount_cny = ROUND(order_amount_usd * exchange_rate, 2)
WHERE currency = 'USD' AND order_amount_cny IS NULL;

UPDATE commission_ledger
SET order_amount_cny = order_amount_usd,
    order_amount_usd = ROUND(order_amount_usd / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1 AND order_amount_usd != 0;

-- 回填：CNY 记录的 xxx_usd 实际存的是 CNY，需交换
UPDATE commission_ledger
SET received_amount_usd = ROUND(received_amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1 AND received_amount_usd != 0;

UPDATE commission_ledger
SET commission_amount_usd = ROUND(commission_amount_cny / exchange_rate, 2)
WHERE currency = 'CNY' AND exchange_rate > 1 AND commission_amount_usd != 0;


-- ============================================================
-- 完成
-- ============================================================
SELECT '双币种迁移完成' AS status;
