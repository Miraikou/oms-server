// ============================================================
// OMS 全功能端到端测试 (Node.js)
// 用法: node test-api.mjs
// ============================================================
const BASE = 'http://localhost:3000/api/v1'
let pass = 0, fail = 0

const green = (s) => `\x1b[32m${s}\x1b[0m`
const red   = (s) => `\x1b[31m${s}\x1b[0m`
const cyan  = (s) => `\x1b[36m${s}\x1b[0m`
const gray  = (s) => `\x1b[90m${s}\x1b[0m`

function check(name, res) {
  if (res.code === 0) { console.log(green(`  [PASS] ${name}`)); pass++ }
  else { console.log(red(`  [FAIL] ${name} (code=${res.code})`)); fail++ }
}

async function post(path, body) {
  const r = await fetch(`${BASE}/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  const json = await r.json()
  if (json.code !== 0) console.error(red(`    POST ${path} -> ${json.message || 'unknown error'}`))
  return json
}

async function get(path) {
  const r = await fetch(`${BASE}/${path}`, { headers })
  return r.json()
}

async function tryPost(path, body) {
  for (let i = 0; i < 3; i++) {
    const res = await post(path, body)
    if (res.code === 0 || res.code >= 40000) return res  // 40000+ is validation error, don't retry
    await sleep(1000)
  }
  return { code: -1, message: 'retry exhausted' }
}

// 等待服务就绪
console.log(cyan('Waiting for server...'))
for (let i = 0; i < 20; i++) {
  try { await fetch(`${BASE}/auth/login`); console.log(cyan('Ready!\n')); break }
  catch { process.stdout.write(`... ${i + 1} `); await sleep(2000) }
}

// ====== 1. Login ======
console.log(cyan('=== 1. Login ==='))
const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
}).then(r => r.json())
const token = login.data.accessToken
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
check('Login', login)

// ====== 2. Base Data ======
console.log(cyan('\n=== 2. Base Data ==='))
const ts = Date.now()
const sup = await post('suppliers', { supplierName: 'S'+ts, contactName: 'Wang', contactPhone: '13800001111', address: 'Shenzhen' })
const sid = sup.data.id; check('Supplier', sup)

const cat = await post('categories', { categoryName: 'C'+ts, parentId: '0' })
const cid = cat.data.id; check('Category', cat)

const p1 = await post('products', { supplierId: sid, categoryId: cid, productName: 'iPhone-Screen', productModel: 'M'+ts+'-1' })
const pid1 = p1.data.id; check('Product1', p1)

const p2 = await post('products', { supplierId: sid, categoryId: cid, productName: 'Samsung-Screen', productModel: 'M'+ts+'-2' })
const pid2 = p2.data.id; check('Product2', p2)

const sp = await post('salespersons', { name: 'SP'+ts, commissionRate: '5.00', phone: '13900002222' })
const spid = sp.data.id; check('Salesperson', sp)

const ch = await post('transport-channels', { name: 'CH'+ts })
const chid = ch.data.id; check('Channel', ch)

const ex = await post('express-companies', { name: 'EX'+ts })
const exid = ex.data.id; check('Express', ex)

const co = await post('cost-types', { name: 'CO'+ts })
const coid = co.data.id; check('CostType', co)

// ====== 3. Purchase & Receipt ======
console.log(cyan('\n=== 3. Purchase & Receipt ==='))
const today = new Date().toISOString().split('T')[0]
const po = await post('purchase-orders', {
  supplierId: sid, purchaseDate: today, currency: 'CNY', exchangeRate: '7.2000',
  items: [
    { productId: pid1, quantity: '200', unitPrice: '200.00' },
    { productId: pid2, quantity: '100', unitPrice: '300.00' },
  ],
})
const poid = po.data.id
const poAmt = po.data.totalAmount
check(`PurchaseOrder(total=${poAmt})`, po)
if (poAmt === '70000.00') console.log(green('    [OK] 200x200+100x300=70000'))
else { console.log(red(`    [ERR] expected 70000 got ${poAmt}`)); fail++ }

// fetch detail to get item IDs
const poDetail = await get(`purchase-orders/${poid}`)
const receipt = await post('purchase-receipts', {
  purchaseOrderId: poid,
  items: [
    { purchaseOrderItemId: poDetail.data.items[0].id, quantity: '200' },
    { purchaseOrderItemId: poDetail.data.items[1].id, quantity: '100' },
  ],
})
check('Receipt', receipt)

const inv = await get('inventories?page=1&pageSize=5')
check('Inventory', inv)
console.log(gray(`  Inventory rows: ${inv.data.list.length}`))

// ====== 4. Sales Order ======
console.log(cyan('\n=== 4. Sales Order ==='))
const order = await post('sales-orders', {
  salespersonId: spid, customerName: 'ABC Corp', orderDate: today,
  transportChannelId: chid, tradeType: 'FOB', exchangeRate: '7.2500',
  items: [
    { productId: pid1, quantity: '100', unitPriceUsd: '50.00' },
    { productId: pid2, quantity: '50', unitPriceUsd: '80.00' },
  ],
})
const oid = order.data.id
check('SalesOrder', order)
if (order.data.totalAmountUsd === '9000.00') console.log(green('    [OK] 100x$50+50x$80=$9000'))
else { console.log(red(`    [ERR] amount: ${order.data.totalAmountUsd}`)); fail++ }

// ====== 5. Shipment (FIFO) ======
console.log(cyan('\n=== 5. Shipment (FIFO) ==='))
const od = await get(`sales-orders/${oid}`)
const oi1 = od.data.items[0].id, oi2 = od.data.items[1].id

const preview = await get(`shipments/preview/${oid}`)
check('Preview', preview)

const ship = await post('shipments', {
  orderId: oid, expressCompanyId: exid, trackingNo: 'SF1234567890',
  shipmentDate: today,
  items: [{ orderItemId: oi1, quantity: '100' }, { orderItemId: oi2, quantity: '50' }],
})
const shipId = ship.data.id
check('Shipment', ship)

const shipD = await get(`shipments/${shipId}`)
for (const it of shipD.data.items) {
  console.log(gray(`  Profit=Y${it.grossProfit} (Sales=$${it.salesAmount} Cost=Y${it.totalCost})`))
}

// ====== 6. Payment ======
console.log(cyan('\n=== 6. Payment ==='))
const pay = await post('payments', {
  orderId: oid, usdAmount: '9000.00', exchangeRate: '7.2500',
  cnyAmount: '65250.00', paymentDate: today, paymentMethod: 'T/T', payer: 'ABC Corp',
})
check('Payment', pay)

const final = await get(`sales-orders/${oid}`)
if (final.data.shipmentStatus === 3 && final.data.paymentStatus === 3 && final.data.status === 2) {
  console.log(green('    [OK] Order completed!'))
} else {
  console.log(red(`    [ERR] Status: ship=${final.data.shipmentStatus} pay=${final.data.paymentStatus} order=${final.data.status}`))
  fail++
}

// ====== 7. Returns & Adjustment ======
console.log(cyan('\n=== 7. Returns & Adjustment ==='))
const si1 = shipD.data.items[0].id
const ret = await post('sales-returns', {
  orderId: oid, returnDate: today, restoreInventory: 1, reason: 'Defective',
  items: [{ shipmentItemId: si1, quantity: '10' }],
})
check('Return(10pcs)', ret)

const adj = await post('inventory-adjustments', {
  reason: 'Manual adjustment',
  items: [{ productId: pid1, changeQuantity: '-5' }],
})
check('Adjustment(-5)', adj)

// ====== 8. Dashboard ======
console.log(cyan('\n=== 8. Dashboard ==='))
const ov = await get('dashboard/overview')
check('Overview', ov)
console.log(gray(`  Sales=$${ov.data.totalSales} Profit=Y${ov.data.totalProfit} Orders=${ov.data.orderCount}`))

const sm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
const se = today
check('Trend', await get(`dashboard/sales-trend?startDate=${sm}&endDate=${se}&granularity=day`))
check('Pending', await get('dashboard/pending-items'))
check('Ranking', await get('dashboard/salesperson-ranking?limit=5'))

// ====== 9. RBAC ======
console.log(cyan('\n=== 9. RBAC ==='))
check('Users', await get('users?page=1'))
check('Roles', await get('roles?page=1'))
check('Menus', await get('menus'))

// ====== 10. OpLogs ======
console.log(cyan('\n=== 10. Operation Logs ==='))
const oplog = await get('operation-logs?page=1&pageSize=10')
check('OpLogs', oplog)
console.log(gray(`  Total logs: ${oplog.data.total}`))

// ====== 11. All Lists ======
console.log(cyan('\n=== 11. All Lists ==='))
const eps = ['suppliers','products','categories','salespersons','express-companies',
             'transport-channels','cost-types','system-configs','common-contacts',
             'purchase-receipts','inventory-flows','inventory-adjustments',
             'sales-returns','purchase-returns','payments','shipments']
for (const ep of eps) check(ep, await get(`${ep}?page=1&pageSize=3`))

// ====== Result ======
console.log(cyan('\n====================================='))
console.log(green(`PASS: ${pass} / ${pass + fail}`))
if (fail > 0) { console.log(red(`FAIL: ${fail}`)); process.exit(1) }
else console.log(green('ALL PASS!'))

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
