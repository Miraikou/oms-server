-- ============================================
-- OMS 多币种标准化改造 — 数据库迁移脚本
-- 执行前请先备份数据库！
-- ============================================

-- ============================================
-- 第一步：创建汇率表
-- ============================================
CREATE TABLE IF NOT EXISTS exchange_rate (
  id BIGINT PRIMARY KEY,
  from_currency VARCHAR(10) NOT NULL COMMENT '源币种',
  to_currency VARCHAR(10) NOT NULL DEFAULT 'CNY' COMMENT '目标币种',
  rate DECIMAL(18,4) NOT NULL COMMENT '汇率',
  effective_date DATE NOT NULL COMMENT '生效日期',
  created_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_currency_date (from_currency, to_currency, effective_date)
) COMMENT '汇率表';

-- 插入当前默认汇率
INSERT INTO exchange_rate (id, from_currency, to_currency, rate, effective_date)
VALUES (1, 'USD', 'CNY', 7.2000, CURDATE());

-- ============================================
-- 第二步：列重命名（SalesOrder）
-- ============================================
ALTER TABLE sales_order CHANGE total_amount_usd total_amount DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_order CHANGE received_amount_usd received_amount DECIMAL(18,2) NOT NULL DEFAULT 0;

-- ============================================
-- 第三步：列重命名（SalesOrderItem）
-- ============================================
ALTER TABLE sales_order_item CHANGE unit_price_usd unit_price DECIMAL(18,2) NOT NULL;
ALTER TABLE sales_order_item CHANGE amount_usd amount DECIMAL(18,2) NOT NULL;

-- ============================================
-- 第四步：列重命名（Payment）
-- ============================================
ALTER TABLE payment CHANGE usd_amount amount DECIMAL(18,2) NOT NULL;
ALTER TABLE payment CHANGE cny_amount base_amount DECIMAL(18,2) NOT NULL;
ALTER TABLE payment MODIFY exchange_rate DECIMAL(18,4) NOT NULL;
ALTER TABLE payment ADD COLUMN currency VARCHAR(10) DEFAULT 'USD' COMMENT '收付款币种' AFTER base_amount;

-- ============================================
-- 第五步：精度统一
-- ============================================
ALTER TABLE sales_order_cost MODIFY exchange_rate DECIMAL(18,4) NOT NULL DEFAULT 1.0000;
ALTER TABLE purchase_order MODIFY exchange_rate DECIMAL(18,4) NOT NULL DEFAULT 1.0000;

-- ============================================
-- 第六步：新增 baseAmount 字段（订单层）
-- ============================================
ALTER TABLE sales_order ADD COLUMN total_base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '订单总金额(CNY)' AFTER total_amount;
ALTER TABLE sales_order ADD COLUMN received_base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '已收金额(CNY)' AFTER received_amount;
ALTER TABLE sales_order ADD COLUMN blogger_commission_base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '博主佣金(CNY)' AFTER blogger_commission_amount;

-- ============================================
-- 第七步：新增 baseAmount 字段（订单明细）
-- ============================================
ALTER TABLE sales_order_item ADD COLUMN base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '销售金额(CNY)' AFTER amount;

-- ============================================
-- 第八步：新增 baseAmount 字段（成本）
-- ============================================
ALTER TABLE sales_order_cost ADD COLUMN base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '成本金额(CNY)' AFTER amount;

-- ============================================
-- 第九步：新增 baseAmount 字段（采购）
-- ============================================
ALTER TABLE purchase_order ADD COLUMN total_base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '采购总额(CNY)' AFTER total_amount;
ALTER TABLE purchase_order_item ADD COLUMN base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '采购金额(CNY)' AFTER amount;
ALTER TABLE purchase_receipt_item ADD COLUMN base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '入库金额(CNY)' AFTER amount;

-- ============================================
-- 第十步：新增字段（出库）
-- ============================================
ALTER TABLE shipment_item ADD COLUMN sales_base_amount DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '销售金额(CNY)' AFTER sales_amount;
ALTER TABLE shipment_item ADD COLUMN currency VARCHAR(10) DEFAULT 'USD' COMMENT '销售币种' AFTER gross_profit;
ALTER TABLE shipment_item ADD COLUMN exchange_rate DECIMAL(18,4) NOT NULL DEFAULT 1.0000 COMMENT '订单汇率' AFTER currency;

ALTER TABLE shipment_item_batch ADD COLUMN unit_cost_base DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '成本单价(CNY)' AFTER unit_cost;
ALTER TABLE shipment_item_batch ADD COLUMN total_cost_base DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '成本金额(CNY)' AFTER total_cost;
ALTER TABLE shipment_item_batch ADD COLUMN currency VARCHAR(10) DEFAULT 'CNY' COMMENT '成本币种' AFTER total_cost_base;
ALTER TABLE shipment_item_batch ADD COLUMN exchange_rate DECIMAL(18,4) NOT NULL DEFAULT 1.0000 COMMENT '成本汇率' AFTER currency;

-- ============================================
-- 第十一步：新增字段（库存）
-- ============================================
ALTER TABLE inventory_batch ADD COLUMN unit_cost_base DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '采购单价(CNY)' AFTER unit_cost;
ALTER TABLE inventory_batch ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'CNY' COMMENT '采购币种' AFTER unit_cost_base;
ALTER TABLE inventory_batch ADD COLUMN exchange_rate DECIMAL(18,4) NOT NULL DEFAULT 1.0000 COMMENT '采购汇率' AFTER currency;

ALTER TABLE inventory_flow ADD COLUMN total_cost_base DECIMAL(18,2) NULL COMMENT '本次总成本(CNY)' AFTER total_cost;
ALTER TABLE inventory_flow ADD COLUMN flow_currency VARCHAR(10) NULL COMMENT '成本币种' AFTER total_cost_base;
ALTER TABLE inventory_flow ADD COLUMN flow_exchange_rate DECIMAL(18,4) NULL COMMENT '成本汇率' AFTER flow_currency;

-- ============================================
-- 第十二步：回填历史数据
-- ============================================

-- SalesOrder: baseAmount = amount × exchangeRate
UPDATE sales_order SET
  total_base_amount = CAST(total_amount AS DECIMAL(18,2)) * CAST(exchange_rate AS DECIMAL(18,4)),
  received_base_amount = CAST(received_amount AS DECIMAL(18,2)) * CAST(exchange_rate AS DECIMAL(18,4)),
  blogger_commission_base_amount = CAST(blogger_commission_amount AS DECIMAL(18,2)) * CAST(exchange_rate AS DECIMAL(18,4));

-- SalesOrderItem: baseAmount = amount × 订单汇率
UPDATE sales_order_item oi
INNER JOIN sales_order so ON oi.order_id = so.id
SET oi.base_amount = CAST(oi.amount AS DECIMAL(18,2)) * CAST(so.exchange_rate AS DECIMAL(18,4));

-- SalesOrderCost: baseAmount = amount × exchangeRate
UPDATE sales_order_cost SET
  base_amount = CAST(amount AS DECIMAL(18,2)) * CAST(exchange_rate AS DECIMAL(18,4));

-- Payment: base_amount 已有（原 cny_amount），只需填 currency
UPDATE payment p
INNER JOIN sales_order so ON p.order_id = so.id
SET p.currency = so.currency;

-- PurchaseOrder: totalBaseAmount = totalAmount × exchangeRate
UPDATE purchase_order SET
  total_base_amount = CAST(total_amount AS DECIMAL(18,2)) * CAST(exchange_rate AS DECIMAL(18,4));

-- PurchaseOrderItem: baseAmount = amount × PO汇率
UPDATE purchase_order_item poi
INNER JOIN purchase_order po ON poi.purchase_order_id = po.id
SET poi.base_amount = CAST(poi.amount AS DECIMAL(18,2)) * CAST(po.exchange_rate AS DECIMAL(18,4));

-- PurchaseReceiptItem: baseAmount = amount × PO汇率
UPDATE purchase_receipt_item pri
INNER JOIN purchase_receipt pr ON pri.receipt_id = pr.id
INNER JOIN purchase_order po ON pr.purchase_order_id = po.id
SET pri.base_amount = CAST(pri.amount AS DECIMAL(18,2)) * CAST(po.exchange_rate AS DECIMAL(18,4));

-- ShipmentItem: salesBaseAmount = salesAmount × 订单汇率
UPDATE shipment_item si
INNER JOIN shipment s ON si.shipment_id = s.id
INNER JOIN sales_order so ON s.order_id = so.id
SET si.sales_base_amount = CAST(si.sales_amount AS DECIMAL(18,2)) * CAST(so.exchange_rate AS DECIMAL(18,4)),
    si.currency = so.currency,
    si.exchange_rate = so.exchange_rate;

-- ShipmentItemBatch: 继承自 InventoryBatch（当前都是 CNY，汇率 1）
UPDATE shipment_item_batch sib
INNER JOIN inventory_batch ib ON sib.inventory_batch_id = ib.id
SET sib.unit_cost_base = ib.unit_cost,
    sib.total_cost_base = sib.total_cost,
    sib.currency = 'CNY',
    sib.exchange_rate = 1.0000;

-- InventoryBatch: 当前都是 CNY 采购
UPDATE inventory_batch SET
  unit_cost_base = unit_cost,
  currency = 'CNY',
  exchange_rate = 1.0000;

-- InventoryFlow: 当前都是 CNY
UPDATE inventory_flow SET
  total_cost_base = total_cost,
  flow_currency = 'CNY',
  flow_exchange_rate = 1.0000
WHERE total_cost IS NOT NULL;
