#!/bin/bash
# OMS 全功能端到端测试脚本
BASE="http://localhost:3000/api/v1"

# 登录
echo "========== 登录 =========="
LOGIN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "TOKEN=${TOKEN:0:30}..."

AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# ===== 基础资料创建 =====
echo ""
echo "========== 1. 创建供应商 =========="
SUPPLIER=$(curl -s -X POST $BASE/suppliers -H "$AUTH" -H "$CT" \
  -d '{"supplierName":"富士康精密","contactName":"王经理","contactPhone":"13800001111","address":"深圳市龙华区"}')
SID=$(echo "$SUPPLIER" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "供应商: $SID, status=$(echo $SUPPLIER | grep -o '"code":[0-9]*')"

echo ""
echo "========== 2. 创建分类 =========="
CAT=$(curl -s -X POST $BASE/categories -H "$AUTH" -H "$CT" \
  -d '{"categoryName":"电子元器件","parentId":"0"}')
CID=$(echo "$CAT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "分类: $CID"

echo ""
echo "========== 3. 创建商品 =========="
PROD=$(curl -s -X POST $BASE/products -H "$AUTH" -H "$CT" \
  -d "{\"supplierId\":\"$SID\",\"categoryId\":\"$CID\",\"productName\":\"iPhone屏幕总成\",\"productModel\":\"IP15PM-SCR-001\",\"imageUrl\":\"https://img.example.com/p1.jpg\",\"remark\":\"OLED组件\"}")
PID=$(echo "$PROD" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "商品: $PID"

echo ""
echo "========== 4. 创建第二个商品 =========="
PROD2=$(curl -s -X POST $BASE/products -H "$AUTH" -H "$CT" \
  -d "{\"supplierId\":\"$SID\",\"categoryId\":\"$CID\",\"productName\":\"三星屏幕总成\",\"productModel\":\"SS-S24U-SCR-001\",\"imageUrl\":\"https://img.example.com/p2.jpg\",\"remark\":\"AMOLED组件\"}")
PID2=$(echo "$PROD2" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "商品2: $PID2"

echo ""
echo "========== 5. 创建销售员 =========="
SP=$(curl -s -X POST $BASE/salespersons -H "$AUTH" -H "$CT" \
  -d '{"name":"李销售","commissionRate":"5.00","phone":"13900002222"}')
SPID=$(echo "$SP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "销售员: $SPID"

echo ""
echo "========== 6. 创建运输渠道 =========="
CH=$(curl -s -X POST $BASE/transport-channels -H "$AUTH" -H "$CT" \
  -d '{"name":"DHL国际快递"}')
CHID=$(echo "$CH" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "渠道: $CHID"

echo ""
echo "========== 7. 创建快递公司 =========="
EX=$(curl -s -X POST $BASE/express-companies -H "$AUTH" -H "$CT" \
  -d '{"name":"顺丰速运"}')
EXID=$(echo "$EX" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "快递公司: $EXID"

echo ""
echo "========== 8. 创建成本类型 =========="
COST=$(curl -s -X POST $BASE/cost-types -H "$AUTH" -H "$CT" \
  -d '{"name":"国际运费"}')
COSTID=$(echo "$COST" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "成本类型: $COSTID"

# ===== 销售订单 =====
echo ""
echo "========== 9. 创建销售订单(含2个商品) =========="
ORDER=$(curl -s -X POST $BASE/sales-orders -H "$AUTH" -H "$CT" \
  -d "{\"salespersonId\":\"$SPID\",\"customerName\":\"美国ABC公司\",\"orderDate\":\"2026-07-06\",\"transportChannelId\":\"$CHID\",\"tradeType\":\"FOB\",\"items\":[{\"productId\":\"$PID\",\"quantity\":\"100\",\"unitPriceUsd\":\"50.00\"},{\"productId\":\"$PID2\",\"quantity\":\"50\",\"unitPriceUsd\":\"80.00\"}]}")
echo "$ORDER" | head -c 500
OID=$(echo "$ORDER" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "订单ID: $OID"

echo ""
echo "========== 10. 查看订单详情(验证金额) =========="
ORDER_DETAIL=$(curl -s "$BASE/sales-orders/$OID" -H "$AUTH")
echo "$ORDER_DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'订单号: {d[\"orderNo\"]}')
print(f'客户: {d[\"customerName\"]}')
print(f'总金额USD: \${d[\"totalAmountUsd\"]}')
print(f'发货状态: {d[\"shipmentStatus\"]} (1=待发货)')
print(f'收款状态: {d[\"paymentStatus\"]} (1=未收款)')
# 验证: 100*50 + 50*80 = 5000 + 4000 = 9000
expected = 100*50.0 + 50*80.0
actual = float(d['totalAmountUsd'])
print(f'金额验证: 期望\${expected} 实际\${actual} {\"✓\" if abs(expected-actual)<0.01 else \"✗ 错误!\"}')
items = d.get('items', [])
for i, item in enumerate(items):
    qty = float(item['quantity'])
    price = float(item['unitPriceUsd'])
    amt = float(item['amountUsd'])
    print(f'  明细{i+1}: qty={qty} price=\${price} amount=\${amt} {\"✓\" if abs(qty*price-amt)<0.01 else \"✗\"}')
" 2>/dev/null || echo "$ORDER_DETAIL" | head -c 800

# ===== 采购单 =====
echo ""
echo "========== 11. 创建采购单 =========="
PURCHASE=$(curl -s -X POST $BASE/purchase-orders -H "$AUTH" -H "$CT" \
  -d "{\"supplierId\":\"$SID\",\"purchaseDate\":\"2026-07-06\",\"currency\":\"CNY\",\"exchangeRate\":\"7.2000\",\"items\":[{\"productId\":\"$PID\",\"quantity\":\"200\",\"unitPrice\":\"200.00\"}]}")
echo "$PURCHASE" | head -c 400
POID=$(echo "$PURCHASE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "采购单ID: $POID"

echo ""
echo "========== 12. 查看采购单详情 =========="
PO_DETAIL=$(curl -s "$BASE/purchase-orders/$POID" -H "$AUTH")
echo "$PO_DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'采购单号: {d[\"purchaseNo\"]}')
print(f'总金额: {d[\"currency\"]} {d[\"totalAmount\"]}')
print(f'汇率: {d[\"exchangeRate\"]}')
items = d.get('items', [])
for i, item in enumerate(items):
    qty = float(item['quantity'])
    price = float(item['unitPrice'])
    amt = float(item['amount'])
    print(f'  明细{i+1}: qty={qty} price={price} amount={amt} {\"✓\" if abs(qty*price-amt)<0.01 else \"✗\"}')
" 2>/dev/null || echo "$PO_DETAIL" | head -c 500

# ===== 采购入库 =====
echo ""
echo "========== 13. 创建入库单 =========="
# 先获取采购单明细ID
PO_ITEM_ID=$(echo "$PO_DETAIL" | grep -o '"id":"[^"]*"' | grep -v "$POID" | head -1 | cut -d'"' -f4)
echo "采购明细ID: $PO_ITEM_ID"
RECEIPT=$(curl -s -X POST $BASE/purchase-receipts -H "$AUTH" -H "$CT" \
  -d "{\"purchaseOrderId\":\"$POID\",\"receiptDate\":\"2026-07-06\",\"items\":[{\"purchaseOrderItemId\":\"$PO_ITEM_ID\",\"quantity\":\"200\"}]}")
echo "$RECEIPT" | head -c 300
RECEIPT_CODE=$(echo "$RECEIPT" | grep -o '"code":[0-9]*')
echo "入库结果: $RECEIPT_CODE"

# ===== 检查库存 =====
echo ""
echo "========== 14. 验证库存数据 =========="
INVENTORY=$(curl -s "$BASE/inventories?page=1&pageSize=5" -H "$AUTH")
echo "$INVENTORY" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'库存记录数: {len(d[\"list\"])}')
for item in d['list']:
    print(f'  商品={item[\"productId\"]} 可用={item[\"availableQuantity\"]} 冻结={item[\"frozenQuantity\"]} 库存={item[\"stockQuantity\"]} 预警={item[\"minimumStock\"]}')
" 2>/dev/null || echo "$INVENTORY" | head -c 500

# 检查库存批次
echo ""
echo "========== 15. 验证库存批次 =========="
BATCHES=$(curl -s "$BASE/products/$PID/batches" -H "$AUTH")
echo "$BATCHES" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'商品 {d[0][\"productId\"] if d else \"N/A\"} 批次数: {len(d)}')
for b in d:
    print(f'  批次[{b[\"batchNo\"]}] 可用={b[\"availableQuantity\"]} 冻结={b[\"frozenQuantity\"]} 库存={b[\"stockQuantity\"]} 成本单价=¥{b[\"unitCost\"]} 状态={b[\"status\"]}')
# 验证: 入库200个，单价200元
if d:
    b = d[0]
    print(f'验证: 入库数量200 库存={b[\"stockQuantity\"]} 成本=¥{b[\"unitCost\"]} {\"✓\" if b[\"stockQuantity\"]==\"200.0000\" and b[\"unitCost\"]==\"200.00\" else \"⚠ 检查\"}')
" 2>/dev/null || echo "$BATCHES" | head -c 500

# ===== 发货 =====
echo ""
echo "========== 16. 创建发货单 =========="
# 先预览发货
echo "--- 发货预览 ---"
PREVIEW=$(curl -s "$BASE/shipments/preview/$OID" -H "$AUTH")
echo "$PREVIEW" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'订单: {d[\"orderNo\"]}')
for item in d['items']:
    print(f'  商品={item[\"productId\"]} 可发={item[\"remainingQuantity\"]} 预估成本=¥{item[\"estimatedCost\"]}')
    for b in item['batches']:
        print(f'    批次={b[\"batchNo\"]} 数量={b[\"quantity\"]} 成本=¥{b[\"unitCost\"]}')
" 2>/dev/null || echo "$PREVIEW" | head -c 600

# 获取订单明细ID用于发货
OITEM_IDS=$(echo "$ORDER_DETAIL" | grep -o '"id":"[^"]*"' | grep -v "$OID" | head -2 | cut -d'"' -f4)
OITEM_ID1=$(echo "$OITEM_IDS" | head -1)
OITEM_ID2=$(echo "$OITEM_IDS" | tail -1)
echo "订单明细1: $OITEM_ID1  明细2: $OITEM_ID2"

SHIPMENT=$(curl -s -X POST $BASE/shipments -H "$AUTH" -H "$CT" \
  -d "{\"orderId\":\"$OID\",\"expressCompanyId\":\"$EXID\",\"trackingNo\":\"SF1234567890\",\"shipmentDate\":\"2026-07-06\",\"items\":[{\"orderItemId\":\"$OITEM_ID1\",\"quantity\":\"100\"},{\"orderItemId\":\"$OITEM_ID2\",\"quantity\":\"50\"}]}")
echo "$SHIPMENT" | head -c 400
SHIP_CODE=$(echo "$SHIPMENT" | grep -o '"code":[0-9]*')
echo "发货结果: $SHIP_CODE"

echo ""
echo "========== 17. 查看发货详情(验证毛利) =========="
SHIP_ID=$(echo "$SHIPMENT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
SHIP_DETAIL=$(curl -s "$BASE/shipments/$SHIP_ID" -H "$AUTH")
echo "$SHIP_DETAIL" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'发货单号: {d[\"shipmentNo\"]}  快递单号: {d[\"trackingNo\"]}')
for item in d['items']:
    sales = float(item['salesAmount'])
    cost = float(item['totalCost'])
    profit = float(item['grossProfit'])
    print(f'  商品={item[\"productId\"]} 数量={item[\"quantity\"]} 销售额=\${sales} 成本=¥{cost} 毛利=¥{profit}')
    # 验证毛利 = 销售额 - 成本
    expected_profit = sales - cost
    match = abs(profit - expected_profit) < 0.01
    print(f'    毛利验证: {profit} = {sales} - {cost} → {\"✓\" if match else \"✗ 错误!\"}')
    for b in item['batches']:
        print(f'    批次={b[\"batchNo\"]} 数量={b[\"quantity\"]} 成本=¥{b[\"unitCost\"]} 总成本=¥{b[\"totalCost\"]}')
" 2>/dev/null || echo "$SHIP_DETAIL" | head -c 600

# ===== 收款 =====
echo ""
echo "========== 18. 创建收款记录 =========="
PAYMENT=$(curl -s -X POST $BASE/payments -H "$AUTH" -H "$CT" \
  -d "{\"orderId\":\"$OID\",\"usdAmount\":\"9000.00\",\"exchangeRate\":\"7.2500\",\"cnyAmount\":\"65250.00\",\"paymentDate\":\"2026-07-06\",\"paymentMethod\":\"电汇\",\"payer\":\"美国ABC公司\"}")
echo "$PAYMENT" | head -c 300
PAY_CODE=$(echo "$PAYMENT" | grep -o '"code":[0-9]*')
echo "收款结果: $PAY_CODE"

# 验证订单状态
echo ""
echo "========== 19. 验证订单最终状态 =========="
FINAL_ORDER=$(curl -s "$BASE/sales-orders/$OID" -H "$AUTH")
echo "$FINAL_ORDER" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'订单号: {d[\"orderNo\"]}')
print(f'总金额: \${d[\"totalAmountUsd\"]}')
print(f'已收金额: \${d[\"receivedAmountUsd\"]}')
print(f'发货状态: {d[\"shipmentStatus\"]} (1=待发货 2=部分发货 3=全部发货)')
print(f'收款状态: {d[\"paymentStatus\"]} (1=未收款 2=部分收款 3=已收款)')
print(f'订单状态: {d[\"status\"]} (1=进行中 2=已完成)')
# 验证: 全部发货(shipmentStatus=3) + 全部收款(paymentStatus=3) → status=2
s = d['shipmentStatus']
p = d['paymentStatus']
st = d['status']
print(f'验证状态: 发货{s}/收款{p}/订单{st} → {\"✓ 已完成\" if s==3 and p==3 and st==2 else \"⚠ 检查\" if st==2 else \"⏳ 进行中\"}')
" 2>/dev/null || echo "$FINAL_ORDER" | head -c 500

# ===== 驾驶舱验证 =====
echo ""
echo "========== 20. 驾驶舱数据验证 =========="
OVERVIEW=$(curl -s "$BASE/dashboard/overview" -H "$AUTH")
echo "$OVERVIEW" | python3 -c "
import sys, json
d = json.load(sys.stdin)['data']
print(f'总销售额: \${d[\"totalSales\"]}')
print(f'总收款额: \${d[\"totalPayment\"]}')
print(f'总利润: \${d[\"totalProfit\"]}')
print(f'利润率: {d[\"profitRate\"]}%')
print(f'订单数: {d[\"orderCount\"]}')
print(f'发货数: {d[\"shipmentCount\"]}')
print(f'总采购额: {d[\"totalPurchase\"]}')
print(f'库存金额: \${d[\"inventoryValue\"]}')
" 2>/dev/null || echo "$OVERVIEW" | head -c 400

echo ""
echo "========== ALL TESTS COMPLETE =========="
