/**
 * 测试数据 Fixtures
 * 提供标准化的测试数据，避免各测试用例之间数据耦合
 */

/** 创建测试用户 */
export function createTestUser(overrides?: Partial<any>) {
  return {
    id: '1000000000000001',
    username: 'testuser',
    password: '$2a$10$hashedpassword',
    realName: '测试用户',
    phone: '13800138000',
    email: 'test@example.com',
    status: 1,
    lastLoginTime: null,
    lastLoginIp: null,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}

/** 创建测试角色 */
export function createTestRole(overrides?: Partial<any>) {
  return {
    id: '2000000000000001',
    roleName: '测试角色',
    roleCode: 'TEST_ROLE',
    status: 1,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}

/** 创建超级管理员角色 */
export function createSuperAdminRole() {
  return createTestRole({
    id: '2000000000000000',
    roleName: '超级管理员',
    roleCode: 'SUPER_ADMIN',
  })
}

/** 创建测试菜单 */
export function createTestMenu(overrides?: Partial<any>) {
  return {
    id: '3000000000000001',
    parentId: null,
    menuName: '测试菜单',
    menuType: 1,
    permission: null,
    path: '/test',
    component: null,
    icon: null,
    sortNo: 1,
    visible: 1,
    status: 1,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}

/** 创建测试按钮权限 */
export function createTestButton(parentId: string, name: string, permission: string) {
  return createTestMenu({
    id: `30000000000${permission.replace(/:/g, '')}`,
    parentId,
    menuName: name,
    menuType: 2,
    permission,
    path: null,
  })
}

/** 创建测试商品 */
export function createTestProduct(overrides?: Partial<any>) {
  return {
    id: '4000000000000001',
    productCode: 'SP001',
    productName: '测试商品',
    productModel: 'MODEL-A',
    supplierId: '5000000000000001',
    categoryId: null,
    unit: '件',
    status: 1,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}

/** 创建测试供应商 */
export function createTestSupplier(overrides?: Partial<any>) {
  return {
    id: '5000000000000001',
    supplierName: '测试供应商',
    contactName: '张三',
    contactPhone: '13800138000',
    address: '测试地址',
    status: 1,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}

/** 创建测试库存汇总 */
export function createTestInventory(overrides?: Partial<any>) {
  return {
    id: '6000000000000001',
    productId: '4000000000000001',
    actualQuantity: '100.0000',
    frozenQuantity: '0.0000',
    availableQuantity: '100.0000',
    version: 1,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}

/** 创建测试库存批次 */
export function createTestBatch(overrides?: Partial<any>) {
  return {
    id: '7000000000000001',
    productId: '4000000000000001',
    inventoryId: '6000000000000001',
    batchNo: 'BATCH-001',
    batchSource: 'purchase_receipt',
    sourceId: '8000000000000001',
    inboundTime: new Date('2026-01-01'),
    unitCostUsd: '50.00',
    unitCostCny: '350.00',
    actualQuantity: '100.0000',
    frozenQuantity: '0.0000',
    availableQuantity: '100.0000',
    freezeStatus: 0,
    version: 1,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}

/** 创建测试销售订单 */
export function createTestOrder(overrides?: Partial<any>) {
  return {
    id: '9000000000000001',
    orderNo: 'SO202601010001',
    salespersonId: null,
    orderDate: new Date('2026-01-01'),
    totalAmountUsd: '1000.00',
    totalAmountCny: '7200.00',
    exchangeRate: '7.2000',
    receivedAmountUsd: '0.00',
    receivedAmountCny: '0.00',
    profit: '0.00',
    status: 1,
    shipmentStatus: 0,
    paymentStatus: 0,
    createdBy: null,
    createdTime: new Date('2026-01-01'),
    updatedBy: null,
    updatedTime: new Date('2026-01-01'),
    remark: null,
    ...overrides,
  }
}
