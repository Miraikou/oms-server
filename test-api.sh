#!/bin/bash
# ============================================================
# OMS 全功能端到端测试脚本
# 使用方法: bash test-api.sh
# 前置条件: MySQL/Redis 已启动，npm run start:dev 已运行
# ============================================================

# 自动检测 WSL 环境，适配 Windows 主机 IP
HOST="localhost"
if grep -qi microsoft /proc/version 2>/dev/null; then
  HOST=$(cat /etc/resolv.conf 2>/dev/null | grep nameserver | awk '{print $2}' | head -1)
  echo "检测到 WSL 环境，使用主机 IP: $HOST"
fi

BASE="http://${HOST}:3000/api/v1"
PASS=0
FAIL=0

# 等待服务就绪
echo "等待服务就绪($BASE)..."
for i in $(seq 1 20); do
  if curl -s "$BASE/auth/login" --connect-timeout 2 -o /dev/null 2>/dev/null; then
    echo "服务已就绪"
    break
  fi
  echo "  ... $i"
  sleep 2
done

# ---------- 辅助函数 ----------
red()   { echo -e "\033[31m$*\033[0m"; }
green() { echo -e "\033[32m$*\033[0m"; }
gray()  { echo -e "\033[90m$*\033[0m"; }

# 从 JSON 中提取 code 字段值
get_code() { echo "$1" | grep -o '"code":[0-9]*' | head -1 | grep -o '[0-9]*'; }

# 从 JSON 中提取第一个 "id" 值
get_id()   { echo "$1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4; }

# 断言 code==0
check() {
  local name="$1" code="$2"
  if [ "$code" = "0" ]; then
    green "  ✓ $name"
    PASS=$((PASS + 1))
    return 0
  else
    red "  ✗ $name (code=$code)"
    FAIL=$((FAIL + 1))
    return 1
  fi
}

# ---------- 1. 登录 ----------
echo ""
echo "========== 1. 登录 =========="
LOGIN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$LOGIN" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
check "登录" "$(get_code "$LOGIN")"
A="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# ---------- 2. 创建基础资料 ----------
echo ""
echo "========== 2. 创建基础资料 =========="

SUPPLIER=$(curl -s -X POST "$BASE/suppliers" -H "$A" -H "$CT" \
  -d '{"supplierName":"富士康精密","contactName":"王经理","contactPhone":"13800001111","address":"深圳市龙华区"}')
SID=$(get_id "$SUPPLIER")
check "创建供应商" "$(get_code "$SUPPLIER")"

CATEGORY=$(curl -s -X POST "$BASE/categories" -H "$A" -H "$CT" \
  -d '{"categoryName":"电子元器件","parentId":"0"}')
CID=$(get_id "$CATEGORY")
check "创建分类" "$(get_code "$CATEGORY")"

P1=$(curl -s -X POST "$BASE/products" -H "$A" -H "$CT" \
  -d "{\"supplierId\":\"$SID\",\"categoryId\":\"$CID\",\"productName\":\"iPhone屏幕总成\",\"productModel\":\"IP15PM-SCR-001\"}")
PID1=$(get_id "$P1")
check "创建商品1(iPhone屏)" "$(get_code "$P1")"

P2=$(curl -s -X POST "$BASE/products" -H "$A" -H "$CT" \
  -d "{\"supplierId\":\"$SID\",\"categoryId\":\"$CID\",\"productName\":\"三星屏幕总成\",\"productModel\":\"SS-S24U-SCR-001\"}")
PID2=$(get_id "$P2")
check "创建商品2(三星屏)" "$(get_code "$P2")"

SP=$(curl -s -X POST "$BASE/salespersons" -H "$A" -H "$CT" \
  -d '{"name":"李销售","commissionRate":"5.00","phone":"13900002222"}')
SPID=$(get_id "$SP")
check "创建销售员" "$(get_code "$SP")"

CH=$(curl -s -X POST "$BASE/transport-channels" -H "$A" -H "$CT" \
  -d '{"name":"DHL国际快递"}')
CHID=$(get_id "$CH")
check "创建运输渠道" "$(get_code "$CH")"

EX=$(curl -s -X POST "$BASE/express-companies" -H "$A" -H "$CT" \
  -d '{"name":"顺丰速运"}')
EXID=$(get_id "$EX")
check "创建快递公司" "$(get_code "$EX")"

COST=$(curl -s -X POST "$BASE/cost-types" -H "$A" -H "$CT" \
  -d '{"name":"国际运费"}')
COSTID=$(get_id "$COST")
check "创建成本类型" "$(get_code "$COST")"

# ---------- 3. 采购入库 ----------
echo ""
echo "========== 3. 采购入库 =========="

# 创建采购单: 200件×¥200 + 100件×¥300 = ¥70000
PO=$(curl -s -X POST "$BASE/purchase-orders" -H "$A" -H "$CT" \
  -d "{\"supplierId\":\"$SID\",\"purchaseDate\":\"$(date +%Y-%m-%d)\",\"currency\":\"CNY\",\"exchangeRate\":\"7.2000\",\"items\":[{\"productId\":\"$PID1\",\"quantity\":\"200\",\"unitPrice\":\"200.00\"},{\"productId\":\"$PID2\",\"quantity\":\"100\",\"unitPrice\":\"300.00\"}]}")
POID=$(get_id "$PO")
PO_AMOUNT=$(echo "$PO" | grep -o '"totalAmount":"[^"]*"' | cut -d'"' -f4)
check "创建采购单(金额=$PO_AMOUNT)" "$(get_code "$PO")"

# 验证金额: 200*200+100*300=70000
if [ "$PO_AMOUNT" = "70000.00" ]; then
  green "    ✓ 金额验证: $PO_AMOUNT == 70000.00"
else
  red "    ✗ 金额验证: 期望70000.00 实际$PO_AMOUNT"
  FAIL=$((FAIL + 1))
fi

# 入库
PO_DETAIL=$(curl -s "$BASE/purchase-orders/$POID" -H "$A")
PO_ITEM1=$(echo "$PO_DETAIL" | grep -o '"id":"[^"]*"' | grep -v "$POID" | head -1 | cut -d'"' -f4)
PO_ITEM2=$(echo "$PO_DETAIL" | grep -o '"id":"[^"]*"' | grep -v "$POID" | tail -1 | cut -d'"' -f4)
RECEIPT=$(curl -s -X POST "$BASE/purchase-receipts" -H "$A" -H "$CT" \
  -d "{\"purchaseOrderId\":\"$POID\",\"items\":[{\"purchaseOrderItemId\":\"$PO_ITEM1\",\"quantity\":\"200\"},{\"purchaseOrderItemId\":\"$PO_ITEM2\",\"quantity\":\"100\"}]}")
check "采购入库" "$(get_code "$RECEIPT")"

# 验证库存
INVENTORY=$(curl -s "$BASE/inventories?page=1&pageSize=5" -H "$A")
check "库存列表" "$(get_code "$INVENTORY")"
INV_TOTAL=$(echo "$INVENTORY" | grep -c '"productId"')
gray "  库存记录数: $INV_TOTAL"

# ---------- 4. 销售订单 ----------
echo ""
echo "========== 4. 销售订单 =========="

# 100件×$50 + 50件×$80 = $9000
ORDER=$(curl -s -X POST "$BASE/sales-orders" -H "$A" -H "$CT" \
  -d "{\"salespersonId\":\"$SPID\",\"customerName\":\"美国ABC公司\",\"orderDate\":\"$(date +%Y-%m-%d)\",\"transportChannelId\":\"$CHID\",\"tradeType\":\"FOB\",\"exchangeRate\":\"7.2500\",\"items\":[{\"productId\":\"$PID1\",\"quantity\":\"100\",\"unitPriceUsd\":\"50.00\"},{\"productId\":\"$PID2\",\"quantity\":\"50\",\"unitPriceUsd\":\"80.00\"}]}")
OID=$(get_id "$ORDER")
check "创建销售订单" "$(get_code "$ORDER")"

# 验证金额
ORDER_AMOUNT=$(echo "$ORDER" | grep -o '"totalAmountUsd":"[^"]*"' | cut -d'"' -f4)
if [ "$ORDER_AMOUNT" = "9000.00" ]; then
  green "    ✓ 金额验证: \$9000.00 (100×\$50+50×\$80)"
else
  red "    ✗ 金额: 期望9000.00 实际$ORDER_AMOUNT"
  FAIL=$((FAIL + 1))
fi

# ---------- 5. FIFO发货 ----------
echo ""
echo "========== 5. FIFO发货 =========="

OD=$(curl -s "$BASE/sales-orders/$OID" -H "$A")
OI1=$(echo "$OD" | grep -o '"id":"[^"]*"' | grep -v "$OID" | head -1 | cut -d'"' -f4)
OI2=$(echo "$OD" | grep -o '"id":"[^"]*"' | grep -v "$OID" | tail -1 | cut -d'"' -f4)

# 预览
PREVIEW=$(curl -s "$BASE/shipments/preview/$OID" -H "$A")
check "发货预览" "$(get_code "$PREVIEW")"

# 全部发货
SHIP=$(curl -s -X POST "$BASE/shipments" -H "$A" -H "$CT" \
  -d "{\"orderId\":\"$OID\",\"expressCompanyId\":\"$EXID\",\"trackingNo\":\"SF1234567890\",\"shipmentDate\":\"$(date +%Y-%m-%d)\",\"items\":[{\"orderItemId\":\"$OI1\",\"quantity\":\"100\"},{\"orderItemId\":\"$OI2\",\"quantity\":\"50\"}]}")
SID=$(get_id "$SHIP")
check "创建发货单" "$(get_code "$SHIP")"

# 验证毛利
SHIP_DETAIL=$(curl -s "$BASE/shipments/$SID" -H "$A")
echo "$SHIP_DETAIL" | grep -o '"grossProfit":"[^"]*"' | while read -r line; do
  profit=$(echo "$line" | cut -d'"' -f4)
  gray "  毛利: ¥$profit"
done

# ---------- 6. 收款 ----------
echo ""
echo "========== 6. 收款 =========="

PAYMENT=$(curl -s -X POST "$BASE/payments" -H "$A" -H "$CT" \
  -d "{\"orderId\":\"$OID\",\"usdAmount\":\"9000.00\",\"exchangeRate\":\"7.2500\",\"cnyAmount\":\"65250.00\",\"paymentDate\":\"$(date +%Y-%m-%d)\",\"paymentMethod\":\"电汇\",\"payer\":\"美国ABC公司\"}")
check "收款 $9000" "$(get_code "$PAYMENT")"

# 验证订单完成状态
FINAL=$(curl -s "$BASE/sales-orders/$OID" -H "$A")
SHIP_ST=$(echo "$FINAL" | grep -o '"shipmentStatus":[0-9]*' | grep -o '[0-9]*' | tail -1)
PAY_ST=$(echo "$FINAL" | grep -o '"paymentStatus":[0-9]*' | grep -o '[0-9]*' | tail -1)
STATUS=$(echo "$FINAL" | grep -o '"status":[0-9]*' | grep -o '[0-9]*' | tail -1)
if [ "$SHIP_ST" = "3" ] && [ "$PAY_ST" = "3" ] && [ "$STATUS" = "2" ]; then
  green "    ✓ 订单完成: 全部发货/已收款/已完成"
else
  red "    ✗ 订单状态异常: 发货$SHIP_ST 收款$PAY_ST 订单$STATUS"
  FAIL=$((FAIL + 1))
fi

# ---------- 7. 退货 ----------
echo ""
echo "========== 7. 退货 =========="

# 客户退货10件
SI1=$(echo "$SHIP_DETAIL" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
RET=$(curl -s -X POST "$BASE/sales-returns" -H "$A" -H "$CT" \
  -d "{\"orderId\":\"$OID\",\"returnDate\":\"$(date +%Y-%m-%d)\",\"restoreInventory\":1,\"reason\":\"瑕疵退货\",\"items\":[{\"shipmentItemId\":\"$SI1\",\"quantity\":\"10\"}]}")
check "客户退货(10件)" "$(get_code "$RET")"

# ---------- 8. 库存调整 ----------
echo ""
echo "========== 8. 库存调整 =========="

ADJ=$(curl -s -X POST "$BASE/inventory-adjustments" -H "$A" -H "$CT" \
  -d '{"reason":"手工盘亏","items":[{"productId":"'"$PID1"'","changeQuantity":"-5"}]}')
check "库存调整(盘亏-5)" "$(get_code "$ADJ")"

# ---------- 9. 驾驶舱 ----------
echo ""
echo "========== 9. 驾驶舱 =========="

OVERVIEW=$(curl -s "$BASE/dashboard/overview" -H "$A")
check "KPI总览" "$(get_code "$OVERVIEW")"
TOTAL_SALES=$(echo "$OVERVIEW" | grep -o '"totalSales":"[^"]*"' | cut -d'"' -f4)
TOTAL_PROFIT=$(echo "$OVERVIEW" | grep -o '"totalProfit":"[^"]*"' | cut -d'"' -f4)
ORDER_COUNT=$(echo "$OVERVIEW" | grep -o '"orderCount":[0-9]*' | grep -o '[0-9]*')
gray "  销售额: \$$TOTAL_SALES  利润: ¥$TOTAL_PROFIT  订单数: $ORDER_COUNT"

SALES_TREND=$(curl -s "$BASE/dashboard/sales-trend?startDate=$(date +%Y-%m)-01&endDate=$(date +%Y-%m-%d)&granularity=day" -H "$A")
check "销售趋势" "$(get_code "$SALES_TREND")"

PURCHASE_TREND=$(curl -s "$BASE/dashboard/purchase-trend?startDate=$(date +%Y-%m)-01&endDate=$(date +%Y-%m-%d)&granularity=day" -H "$A")
check "采购趋势" "$(get_code "$PURCHASE_TREND")"

PENDING=$(curl -s "$BASE/dashboard/pending-items" -H "$A")
check "待办事项" "$(get_code "$PENDING")"

RANKING=$(curl -s "$BASE/dashboard/salesperson-ranking?limit=5" -H "$A")
check "销售员排行" "$(get_code "$RANKING")"

# ---------- 10. RBAC ----------
echo ""
echo "========== 10. RBAC管理 =========="

USER_LIST=$(curl -s "$BASE/users?page=1&pageSize=5" -H "$A")
check "用户列表" "$(get_code "$USER_LIST")"

ROLE_LIST=$(curl -s "$BASE/roles?page=1&pageSize=5" -H "$A")
check "角色列表" "$(get_code "$ROLE_LIST")"

MENU_LIST=$(curl -s "$BASE/menus" -H "$A")
check "菜单列表" "$(get_code "$MENU_LIST")"

# ---------- 11. 操作日志 ----------
echo ""
echo "========== 11. 操作日志 =========="

OP_LOG=$(curl -s "$BASE/operation-logs?page=1&pageSize=10" -H "$A")
check "操作日志列表" "$(get_code "$OP_LOG")"
OP_COUNT=$(echo "$OP_LOG" | grep -o '"total":[0-9]*' | grep -o '[0-9]*' | head -1)
gray "  操作日志总数: $OP_COUNT"

# ---------- 12. 其他基础资料 ----------
echo ""
echo "========== 12. 列表接口抽查 =========="

for endpoint in "suppliers" "products" "categories" "salespersons" \
                "express-companies" "transport-channels" "cost-types" \
                "system-configs" "common-contacts" \
                "purchase-receipts" "inventory-flows" \
                "sales-returns" "purchase-returns" "payments" "shipments"; do
  resp=$(curl -s "$BASE/$endpoint?page=1&pageSize=3" -H "$A")
  check "$endpoint" "$(get_code "$resp")"
done

# ---------- 结果汇总 ----------
echo ""
echo "=============================================="
TOTAL=$((PASS + FAIL))
green "通过: $PASS / $TOTAL"
if [ "$FAIL" -gt 0 ]; then
  red "失败: $FAIL"
  exit 1
else
  green "全部通过！"
fi
