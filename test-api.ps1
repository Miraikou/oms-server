# ============================================================
# OMS E2E Test
# Usage: .\test-api.ps1
# ============================================================

$Base = "http://localhost:3000/api/v1"
$Pass = 0
$Fail = 0

function Check($name, $resp) {
  $code = if ($resp.code) { $resp.code } else { "" }
  if ($code -eq 0) {
    Write-Host "  [PASS] $name" -Fore Green
    $script:Pass++
  } else {
    Write-Host "  [FAIL] $name (code=$code)" -Fore Red
    $script:Fail++
  }
}

function Post($path, $body) {
  $json = $body | ConvertTo-Json -Compress -Depth 10
  return Invoke-RestMethod -Uri "$Base/$path" -Method Post -Headers $Headers -Body $json -ContentType "application/json"
}

function Get($path) {
  return Invoke-RestMethod -Uri "$Base/$path" -Method Get -Headers $Headers
}

# wait for server
Write-Host "Waiting for server..." -Fore Cyan
for ($i=1; $i -le 20; $i++) {
  try { $null = Get "auth/login"; Write-Host "Ready!"; break }
  catch { Write-Host "  ... $i"; Start-Sleep 2 }
}

# login
Write-Host "`n=== 1. Login ===" -Fore Cyan
$Login = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -ContentType "application/json" `
  -Body '{"username":"admin","password":"admin123"}'
$Token = $Login.data.accessToken
$Headers = @{ "Authorization" = "Bearer $Token" }
Check "Login" $Login

# base data
Write-Host "`n=== 2. Base Data ===" -Fore Cyan

$Sup = Post "suppliers" @{supplierName="Foxconn"; contactName="Wang"; contactPhone="13800001111"; address="Shenzhen"}
$Sid = $Sup.data.id; Check "Supplier" $Sup

$Cat = Post "categories" @{categoryName="Electronics"; parentId="0"}
$Cid = $Cat.data.id; Check "Category" $Cat

$Prod1 = Post "products" @{supplierId=$Sid; categoryId=$Cid; productName="iPhone Screen"; productModel="IP15PM-001"}
$Pid1 = $Prod1.data.id; Check "Product1" $Prod1

$Prod2 = Post "products" @{supplierId=$Sid; categoryId=$Cid; productName="Samsung Screen"; productModel="SS-S24-001"}
$Pid2 = $Prod2.data.id; Check "Product2" $Prod2

$Sp = Post "salespersons" @{name="Mr.Li"; commissionRate="5.00"; phone="13900002222"}
$Spid = $Sp.data.id; Check "Salesperson" $Sp

$Ch = Post "transport-channels" @{name="DHL Express"}
$Chid = $Ch.data.id; Check "Channel" $Ch

$Ex = Post "express-companies" @{name="SF Express"}
$Exid = $Ex.data.id; Check "Express" $Ex

$Co = Post "cost-types" @{name="Freight"}
$Coid = $Co.data.id; Check "CostType" $Co

# purchase + receipt
Write-Host "`n=== 3. Purchase & Receipt ===" -Fore Cyan

$today = Get-Date -Format "yyyy-MM-dd"
$PoBody = @{
  supplierId = $Sid
  purchaseDate = $today
  currency = "CNY"
  exchangeRate = "7.2000"
  items = @(
    @{productId=$Pid1; quantity="200"; unitPrice="200.00"},
    @{productId=$Pid2; quantity="100"; unitPrice="300.00"}
  )
}
$Po = Post "purchase-orders" $PoBody
$Poid = $Po.data.id
$PoAmt = $Po.data.totalAmount
Check "PurchaseOrder(total=$PoAmt)" $Po
if ($PoAmt -eq "70000.00") { Write-Host "    [OK] 200x200+100x300=70000" -Fore Green } else { Write-Host "    [ERR] expected 70000 got $PoAmt" -Fore Red; $Fail++ }

$PoItems = $Po.data.items
$ReceiptBody = @{
  purchaseOrderId = $Poid
  items = @(
    @{purchaseOrderItemId=$PoItems[0].id; quantity="200"},
    @{purchaseOrderItemId=$PoItems[1].id; quantity="100"}
  )
}
$Receipt = Post "purchase-receipts" $ReceiptBody
Check "Receipt" $Receipt

$Inv = Get "inventories?page=1&pageSize=5"
Check "Inventory" $Inv
Write-Host "  Inventory rows: $($Inv.data.list.Count)" -Fore Gray

# sales order
Write-Host "`n=== 4. Sales Order ===" -Fore Cyan

$OrderBody = @{
  salespersonId = $Spid
  customerName = "ABC Corp"
  orderDate = $today
  transportChannelId = $Chid
  tradeType = "FOB"
  exchangeRate = "7.2500"
  items = @(
    @{productId=$Pid1; quantity="100"; unitPriceUsd="50.00"},
    @{productId=$Pid2; quantity="50"; unitPriceUsd="80.00"}
  )
}
$Order = Post "sales-orders" $OrderBody
$Oid = $Order.data.id
Check "SalesOrder" $Order
if ($Order.data.totalAmountUsd -eq "9000.00") { Write-Host "    [OK] 100x50+50x80=9000" -Fore Green } else { Write-Host "    [ERR] amount check" -Fore Red; $Fail++ }

# shipment
Write-Host "`n=== 5. Shipment (FIFO) ===" -Fore Cyan

$Od = Get "sales-orders/$Oid"
$Oi1 = $Od.data.items[0].id
$Oi2 = $Od.data.items[1].id

$Preview = Get "shipments/preview/$Oid"
Check "Preview" $Preview

$ShipBody = @{
  orderId = $Oid
  expressCompanyId = $Exid
  trackingNo = "SF1234567890"
  shipmentDate = $today
  items = @(
    @{orderItemId=$Oi1; quantity="100"},
    @{orderItemId=$Oi2; quantity="50"}
  )
}
$Ship = Post "shipments" $ShipBody
$ShipId = $Ship.data.id
Check "Shipment" $Ship

$ShipD = Get "shipments/$ShipId"
foreach ($it in $ShipD.data.items) {
  Write-Host "  Profit=Y$($it.grossProfit) (Sales=$$($it.salesAmount) Cost=Y$($it.totalCost))" -Fore Gray
}

# payment
Write-Host "`n=== 6. Payment ===" -Fore Cyan

$PayBody = @{
  orderId = $Oid
  usdAmount = "9000.00"
  exchangeRate = "7.2500"
  cnyAmount = "65250.00"
  paymentDate = $today
  paymentMethod = "T/T"
  payer = "ABC Corp"
}
$Pay = Post "payments" $PayBody
Check "Payment" $Pay

$Final = Get "sales-orders/$Oid"
if ($Final.data.shipmentStatus -eq 3 -and $Final.data.paymentStatus -eq 3 -and $Final.data.status -eq 2) {
  Write-Host "    [OK] Order completed!" -Fore Green
} else {
  Write-Host "    [ERR] Status: ship=$($Final.data.shipmentStatus) pay=$($Final.data.paymentStatus) order=$($Final.data.status)" -Fore Red; $Fail++
}

# returns + adjustment
Write-Host "`n=== 7. Returns & Adjustment ===" -Fore Cyan

$Si1 = $ShipD.data.items[0].id
$RetBody = @{
  orderId = $Oid
  returnDate = $today
  restoreInventory = 1
  reason = "Defective"
  items = @(@{shipmentItemId=$Si1; quantity="10"})
}
$Ret = Post "sales-returns" $RetBody
Check "Return(10pcs)" $Ret

$AdjBody = @{
  reason = "Manual adjustment"
  items = @(@{productId=$Pid1; changeQuantity="-5"})
}
$Adj = Post "inventory-adjustments" $AdjBody
Check "Adjustment(-5)" $Adj

# dashboard
Write-Host "`n=== 8. Dashboard ===" -Fore Cyan

$Ov = Get "dashboard/overview"
Check "Overview" $Ov
Write-Host "  Sales=$$($Ov.data.totalSales) Profit=Y$($Ov.data.totalProfit) Orders=$($Ov.data.orderCount)" -Fore Gray

$sm = (Get-Date -Format "yyyy-MM") + "-01"
$se = Get-Date -Format "yyyy-MM-dd"
Check "Trend" (Get "dashboard/sales-trend?startDate=$sm&endDate=$se&granularity=day")
Check "Pending" (Get "dashboard/pending-items")
Check "Ranking" (Get "dashboard/salesperson-ranking?limit=5")

# RBAC
Write-Host "`n=== 9. RBAC ===" -Fore Cyan
Check "Users" (Get "users?page=1")
Check "Roles" (Get "roles?page=1")
Check "Menus" (Get "menus")

# operation logs
Write-Host "`n=== 10. Operation Logs ===" -Fore Cyan
$OpLog = Get "operation-logs?page=1&pageSize=10"
Check "OpLogs" $OpLog
Write-Host "  Total logs: $($OpLog.data.total)" -Fore Gray

# list checks
Write-Host "`n=== 11. All Lists ===" -Fore Cyan
$eps = @("suppliers","products","categories","salespersons","express-companies",
         "transport-channels","cost-types","system-configs","common-contacts",
         "purchase-receipts","inventory-flows","inventory-adjustments",
         "sales-returns","purchase-returns","payments","shipments")
foreach ($ep in $eps) {
  Check $ep (Get "$ep?page=1&pageSize=3")
}

# result
Write-Host "`n=====================================" -Fore Cyan
$total = $Pass + $Fail
Write-Host "PASS: $Pass / $total" -Fore Green
if ($Fail -gt 0) { Write-Host "FAIL: $Fail" -Fore Red } else { Write-Host "ALL PASS!" -Fore Green }
