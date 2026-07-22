import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { BadRequestException } from '@nestjs/common'
import { ShipmentService } from '../shipment.service'
import { Shipment } from '../entities/shipment.entity'
import { ShipmentItem } from '../entities/shipment-item.entity'
import { ShipmentItemBatch } from '../entities/shipment-item-batch.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity'
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity'
import { ProductModel } from '@/modules/product/entities/product-model.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { FifoService } from '@/modules/inventory/services/fifo.service'
import { SalesOrderService } from '@/modules/sales-order/sales-order.service'
import { RateService } from '@/common/rate/rate.service'
import { CommissionService } from '@/modules/commission/commission.service'

// ─── 全局 Mock：Snowflake ID 生成 ─────────────────────────
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

/** 创建链式 QueryBuilder mock */
function createQB() {
  return {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawAndEntities: jest.fn(),
    getCount: jest.fn(),
  }
}

// ─── 注入的 Repositories（事务外路径：preview / findOne / findAll / create 前置校验） ───
const mockShipmentRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockItemRepo = {
  find: jest.fn(),
}

const mockBatchRepo = {
  find: jest.fn(),
}

const mockOrderRepo = {
  findOne: jest.fn(),
}

const mockOrderItemRepo = {
  find: jest.fn(),
}

const mockInventoryBatchRepo = {
  createQueryBuilder: jest.fn(),
  find: jest.fn(),
}

const mockProductModelRepo = {
  find: jest.fn(),
}

// ─── Mock Services ─────────────────────────────────────────
const mockSequenceService = {
  generate: jest.fn(),
}

const mockFifoService = {
  consume: jest.fn(),
}

const mockSalesOrderService = {
  updateShippedQuantity: jest.fn().mockResolvedValue(undefined),
}

const mockRateService = {
  getDefaultRate: jest.fn().mockReturnValue('7.0000'),
}

const mockCommissionService = {
  accrueOrderCommission: jest.fn().mockResolvedValue(undefined),
}

// ─── Mock Manager（事务内：getRepository + createQueryBuilder） ───
const mockManager = {
  getRepository: jest.fn(),
  createQueryBuilder: jest.fn(),
}

// 事务内各实体 repo / QB（每个测试重建）
let mgrShipmentRepo: { create: jest.Mock; save: jest.Mock }
let mgrItemRepo: { create: jest.Mock; save: jest.Mock }
let mgrBatchRepo: { create: jest.Mock; save: jest.Mock }
let mgrOrderRepo: { findOne: jest.Mock }
let orderItemQB: ReturnType<typeof createQB> // SalesOrderItem（TOCTOU 重验）
let orderQB: ReturnType<typeof createQB> // SalesOrder（M2 重验）

// ─── Mock DataSource（transaction + 原生查询） ───────────────
const mockDataSourceQB = createQB()
const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
  createQueryBuilder: jest.fn(() => mockDataSourceQB),
}

// ========== 测试数据 ==========
const mockOrder = {
  id: 'order-1',
  orderNo: 'ORD20260700001',
  customerName: '测试客户',
  status: 1,
  shipmentStatus: 1,
  currency: 'USD',
  exchangeRate: '7.0000',
  salespersonId: null,
}

const mockOrderItem = {
  id: 'orderItem-1',
  orderId: 'order-1',
  productId: 'prod-1',
  productModelId: null,
  quantity: '20',
  shippedQuantity: '0',
  returnedQuantity: '0',
  refundReturnedQuantity: '0',
  unitPriceUsd: '100.00',
  unitPriceCny: '700.00',
}

// FIFO consume 返回结果（扣减可用库存后的批次明细）
const mockFifoResult = {
  items: [
    {
      batchId: 'b1',
      quantity: 10,
      unitCostUsd: '50.00',
      totalCostUsd: '500.00',
      unitCostCny: '350.00',
      totalCostCny: '3500.00',
      currency: 'USD',
      exchangeRate: '7.0000',
    },
  ],
  totalCostUsd: '500.00',
  totalCostCny: '3500.00',
}

const dto = {
  orderId: 'order-1',
  expressCompanyId: 'express-1',
  trackingNo: 'SF1234567890',
  shipmentDate: '2026-07-01',
  remark: '快件发运',
  items: [{ orderItemId: 'orderItem-1', quantity: '10' }],
}

describe('ShipmentService', () => {
  let service: ShipmentService

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentService,
        { provide: getRepositoryToken(Shipment), useValue: mockShipmentRepo },
        { provide: getRepositoryToken(ShipmentItem), useValue: mockItemRepo },
        { provide: getRepositoryToken(ShipmentItemBatch), useValue: mockBatchRepo },
        { provide: getRepositoryToken(SalesOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(SalesOrderItem), useValue: mockOrderItemRepo },
        { provide: getRepositoryToken(InventoryBatch), useValue: mockInventoryBatchRepo },
        { provide: getRepositoryToken(ProductModel), useValue: mockProductModelRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: FifoService, useValue: mockFifoService },
        { provide: SalesOrderService, useValue: mockSalesOrderService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: RateService, useValue: mockRateService },
        { provide: CommissionService, useValue: mockCommissionService },
      ],
    }).compile()

    service = module.get<ShipmentService>(ShipmentService)
  })

  beforeEach(() => {
    jest.clearAllMocks()

    // 每个测试重建事务内 repo / QB，并按实体路由
    mgrShipmentRepo = { create: jest.fn(), save: jest.fn() }
    mgrItemRepo = { create: jest.fn(), save: jest.fn() }
    mgrBatchRepo = { create: jest.fn(), save: jest.fn() }
    mgrOrderRepo = { findOne: jest.fn() }
    orderItemQB = createQB()
    orderQB = createQB()

    mockManager.getRepository.mockImplementation((entity: any) => {
      if (entity === Shipment) return mgrShipmentRepo
      if (entity === ShipmentItem) return mgrItemRepo
      if (entity === ShipmentItemBatch) return mgrBatchRepo
      if (entity === SalesOrder) return mgrOrderRepo
      return {}
    })
    mockManager.createQueryBuilder.mockImplementation((entity: any) => {
      if (entity === SalesOrderItem) return orderItemQB
      if (entity === SalesOrder) return orderQB
      return createQB()
    })

    mgrShipmentRepo.create.mockImplementation((data: any) => ({ ...data }))
    mgrShipmentRepo.save.mockImplementation((e: any) => Promise.resolve(e))
    mgrItemRepo.create.mockImplementation((data: any) => ({ ...data }))
    mgrItemRepo.save.mockImplementation((e: any) => Promise.resolve(e))
    mgrBatchRepo.create.mockImplementation((data: any) => ({ ...data }))
    mgrBatchRepo.save.mockImplementation((e: any) => Promise.resolve(e))

    mockSequenceService.generate.mockResolvedValue('FH202601010001')
  })

  // ═══════════════════════════════════════════════════════════
  // create - 创建发货单
  // ═══════════════════════════════════════════════════════════
  describe('create', () => {
    it('应成功创建发货单（FIFO 扣减可用库存、批次、成本/利润、订单更新）', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue([mockOrderItem])
      // 事务内 TOCTOU 重验
      orderItemQB.getOne.mockResolvedValue({ ...mockOrderItem })
      orderQB.getOne.mockResolvedValue({ ...mockOrder, status: 1 })
      // FIFO 扣减可用库存
      mockFifoService.consume.mockResolvedValue(mockFifoResult)
      // step8 重读订单（仍进行中，不触发提成）
      mgrOrderRepo.findOne.mockResolvedValue({ ...mockOrder, status: 1 })

      const result = await service.create(dto)

      // 前置校验查询
      expect(mockOrderRepo.findOne).toHaveBeenCalledWith({ where: { id: 'order-1' } })
      expect(mockOrderItemRepo.find).toHaveBeenCalledWith({ where: { orderId: 'order-1' } })
      // 发货单号生成
      expect(mockSequenceService.generate).toHaveBeenCalledWith('FH')
      // 发货单创建（type=1 正常发货）
      expect(mgrShipmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentNo: 'FH202601010001',
          orderId: 'order-1',
          status: 1,
          type: 1,
        }),
      )
      // ⭐ 无预留模型核心断言：发货调用 consume 从可用库存扣减（而非 deductFrozen）
      expect(mockFifoService.consume).toHaveBeenCalledWith(
        'prod-1', // productId
        null, // productModelId
        10, // shipQty
        '9999999999999999', // savedShipment.id
        2, // businessType 销售发货
        mockManager, // 事务 manager
        2, // changeType 出库
      )
      // 发货明细创建（销售金额 = 10 × 100.00 = 1000.00 USD / 7000.00 CNY）
      expect(mgrItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderItemId: 'orderItem-1',
          productId: 'prod-1',
          quantity: '10',
          salesUnitPriceUsd: '100.00',
          salesUnitPriceCny: '700.00',
          salesAmountUsd: '1000.00',
          salesAmountCny: '7000.00',
        }),
      )
      // 批次明细创建
      expect(mgrBatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          inventoryBatchId: 'b1',
          quantity: '10',
          unitCostUsd: '50.00',
          totalCostUsd: '500.00',
        }),
      )
      // 明细 save 两次（创建 + 成本/利润更新）
      expect(mgrItemRepo.save).toHaveBeenCalledTimes(2)
      // 成本/利润更新（毛利 = 销售金额 - FIFO 实际成本）
      expect(mgrItemRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          totalCostCny: '3500.00',
          totalCostUsd: '500.00',
          grossProfitCny: '3500.00', // 7000 - 3500
          grossProfitUsd: '500.00', // 1000 - 500
        }),
      )
      // 订单已发数量更新
      expect(mockSalesOrderService.updateShippedQuantity).toHaveBeenCalledWith(
        'order-1',
        'orderItem-1',
        10,
        mockManager,
      )
      expect(result.shipmentNo).toBe('FH202601010001')
    })

    it('⭐ 库存不足时 consume 抛错，发货被拒绝（无预留模型：仅发货环节拦截）', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue([mockOrderItem])
      orderItemQB.getOne.mockResolvedValue({ ...mockOrderItem })
      orderQB.getOne.mockResolvedValue({ ...mockOrder, status: 1 })
      mockFifoService.consume.mockRejectedValue(
        new BadRequestException('库存不足：需要 10，可用 5'),
      )

      await expect(service.create(dto)).rejects.toThrow('库存不足')
      // 不应更新订单已发数量
      expect(mockSalesOrderService.updateShippedQuantity).not.toHaveBeenCalled()
    })

    it('补发发货单（type=2）销售金额按 0 计（纯成本单据）', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue([mockOrderItem])
      // 存在"补发不退货"记录
      mockDataSourceQB.getCount.mockResolvedValueOnce(1)
      orderItemQB.getOne.mockResolvedValue({ ...mockOrderItem })
      orderQB.getOne.mockResolvedValue({ ...mockOrder, status: 1 })
      mockFifoService.consume.mockResolvedValue(mockFifoResult)
      mgrOrderRepo.findOne.mockResolvedValue({ ...mockOrder, status: 1 })

      await service.create({ ...dto, type: 2 })

      // 发货单 type=2
      expect(mgrShipmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 2 }),
      )
      // 销售单价/金额按 0 计
      expect(mgrItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          salesUnitPriceUsd: '0.00',
          salesUnitPriceCny: '0.00',
          salesAmountUsd: '0.00',
          salesAmountCny: '0.00',
        }),
      )
      // 毛利 = 0 - 成本
      expect(mgrItemRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          grossProfitCny: '-3500.00',
          grossProfitUsd: '-500.00',
        }),
      )
    })

    it('补发发货单但无"补发不退货"记录时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockDataSourceQB.getCount.mockResolvedValueOnce(0)

      await expect(service.create({ ...dto, type: 2 })).rejects.toThrow(
        '补发不退货',
      )
      expect(mockDataSource.transaction).not.toHaveBeenCalled()
    })

    it('发货明细为空时应抛出异常', async () => {
      await expect(service.create({ ...dto, items: [] })).rejects.toThrow(
        '发货明细不能为空',
      )
    })

    it('订单不存在时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.create(dto)).rejects.toThrow('订单不存在')
    })

    it('订单状态非进行中（status !== 1）时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue({ ...mockOrder, status: 2 })

      await expect(service.create(dto)).rejects.toThrow('订单已结束，无法发货')
    })

    it('订单已全部发货（shipmentStatus === 3）时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue({ ...mockOrder, shipmentStatus: 3 })

      await expect(service.create(dto)).rejects.toThrow('订单已全部发货，无法再次发货')
    })

    it('订单明细 ID 不存在时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue([mockOrderItem])
      const badDto = { ...dto, items: [{ orderItemId: 'nonexistent', quantity: '10' }] }

      await expect(service.create(badDto)).rejects.toThrow('订单明细 nonexistent 不存在')
    })

    it('发货数量超过可发数量时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue([mockOrderItem]) // 可发 20
      const exceedDto = { ...dto, items: [{ orderItemId: 'orderItem-1', quantity: '30' }] }

      await expect(service.create(exceedDto)).rejects.toThrow('发货数量 30 超过可发数量 20')
    })
  })

  // ═══════════════════════════════════════════════════════════
  // preview - 发货预览
  // ═══════════════════════════════════════════════════════════
  describe('preview', () => {
    const previewOrderItems = [
      {
        id: 'orderItem-1',
        productId: 'prod-1',
        productModelId: null,
        quantity: '20',
        shippedQuantity: '5',
        returnedQuantity: '0',
        refundReturnedQuantity: '0',
        unitPriceUsd: '100.00',
      },
      {
        id: 'orderItem-2',
        productId: 'prod-2',
        productModelId: null,
        quantity: '10',
        shippedQuantity: '10',
        returnedQuantity: '0',
        refundReturnedQuantity: '0',
        unitPriceUsd: '50.00',
      },
    ]

    it('应基于可用库存返回 FIFO 预估批次（无预留模型）', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue(previewOrderItems)

      const previewQB = createQB()
      previewQB.getMany.mockResolvedValue([
        {
          id: 'b1',
          batchNo: 'BT001',
          productId: 'prod-1',
          availableQuantity: '20',
          unitCostUsd: '50.00',
          unitCostCny: '350.00',
          inboundTime: new Date('2026-01-01'),
        },
      ])
      mockInventoryBatchRepo.createQueryBuilder.mockReturnValue(previewQB)

      const result = await service.preview('order-1')

      expect(result.orderNo).toBe('ORD20260700001')
      // ⭐ 无预留模型核心断言：批次查询按可用库存筛选（status=1 且 availableQuantity>0），而非冻结量
      expect(previewQB.andWhere).toHaveBeenCalledWith('b.status = :status', { status: 1 })
      expect(previewQB.andWhere).toHaveBeenCalledWith('b.availableQuantity > 0')
      // 仅包含有剩余数量的明细（orderItem-1 剩余 15，orderItem-2 剩余 0 被跳过）
      expect(result.items).toHaveLength(1)
      expect(result.items[0].orderItemId).toBe('orderItem-1')
      expect(result.items[0].remainingQuantity).toBe(15)
      expect(result.items[0].batches).toHaveLength(1)
      expect(result.items[0].batches[0].batchId).toBe('b1')
      expect(result.items[0].batches[0].quantity).toBe(15) // min(available=20, need=15)
      expect(result.items[0].batches[0].totalCost).toBe('750.00') // 15 × 50
      expect(result.items[0].estimatedCost).toBe('750.00')
    })

    it('所有明细无剩余数量时应跳过', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue([
        { id: 'item-1', productId: 'prod-1', productModelId: null, quantity: '10', shippedQuantity: '10', unitPriceUsd: '100.00' },
      ])

      const result = await service.preview('order-1')

      expect(result.items).toHaveLength(0)
    })

    it('订单不存在时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.preview('nonexistent')).rejects.toThrow('订单不存在')
    })
  })

  // ═══════════════════════════════════════════════════════════
  // findOne - 查询发货单详情（聚合）
  // ═══════════════════════════════════════════════════════════
  describe('findOne', () => {
    const mockShipment = { id: 'shipment-1', shipmentNo: 'FH202601010001', orderId: 'order-1' }
    const mockItems = [
      { id: 'item-1', shipmentId: 'shipment-1', orderItemId: 'oi-1', productId: 'prod-1', productModelId: null },
      { id: 'item-2', shipmentId: 'shipment-1', orderItemId: 'oi-2', productId: 'prod-2', productModelId: null },
    ]

    it('应返回发货单及明细和批次信息', async () => {
      mockShipmentRepo.findOne.mockResolvedValue(mockShipment)
      mockItemRepo.find.mockResolvedValue(mockItems)
      // dataSource 原生查询：products → 已退数量聚合
      mockDataSourceQB.getRawMany
        .mockResolvedValueOnce([
          { id: 'prod-1', product_name: '商品A' },
          { id: 'prod-2', product_name: '商品B' },
        ])
        .mockResolvedValueOnce([]) // 无退货
      // 批次 + 批次号
      mockBatchRepo.find.mockResolvedValue([
        { id: 'batch-1', shipmentItemId: 'item-1', inventoryBatchId: 'b1', quantity: '10', unitCostUsd: '50.00' },
      ])
      mockInventoryBatchRepo.find.mockResolvedValue([{ id: 'b1', batchNo: 'BT001' }])

      const result = await service.findOne('shipment-1')

      expect(result.id).toBe('shipment-1')
      expect(result.items).toHaveLength(2)
      expect(result.items[0].productName).toBe('商品A')
      expect(result.items[0].batches).toHaveLength(1)
      expect(result.items[0].batches[0].inventoryBatchId).toBe('b1')
      expect(result.items[0].batches[0].batchNo).toBe('BT001')
      expect(result.items[0].returnedQty).toBe(0)
      expect(result.items[1].batches).toHaveLength(0)
    })

    it('发货单不存在时应抛出异常', async () => {
      mockShipmentRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('nonexistent')).rejects.toThrow('发货单不存在')
    })
  })

  // ═══════════════════════════════════════════════════════════
  // findAll - 分页查询发货单列表
  // ═══════════════════════════════════════════════════════════
  describe('findAll', () => {
    const mockListQB = {
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn(),
      getCount: jest.fn(),
    }

    beforeEach(() => {
      mockShipmentRepo.createQueryBuilder.mockReturnValue(mockListQB)
    })

    it('应按筛选条件分页查询', async () => {
      mockListQB.getRawAndEntities.mockResolvedValue({
        entities: [{ id: 's-1', shipmentNo: 'FH202601010001' }],
        raw: [{ orderNo: 'SO001' }],
      })
      mockListQB.getCount.mockResolvedValue(1)

      const result = await service.findAll({
        shipmentNo: 'FH2026',
        orderId: 'order-1',
        expressCompanyId: 'express-1',
        trackingNo: 'SF',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        page: 1,
        pageSize: 10,
        sortField: 'createdTime',
        sortOrder: 'DESC' as const,
      })

      expect(mockShipmentRepo.createQueryBuilder).toHaveBeenCalledWith('s')
      // shipmentNo / orderId / expressCompanyId / trackingNo / startDate / endDate 共 6 个 andWhere
      expect(mockListQB.andWhere).toHaveBeenCalledTimes(6)
      expect(mockListQB.orderBy).toHaveBeenCalledWith('s.createdTime', 'DESC')
      expect(mockListQB.skip).toHaveBeenCalledWith(0)
      expect(mockListQB.take).toHaveBeenCalledWith(10)
      expect(result.list).toEqual([
        { id: 's-1', shipmentNo: 'FH202601010001', orderNo: 'SO001', currency: null },
      ])
      expect(result.total).toBe(1)
    })

    it('未传参数时应使用默认分页（page=1, pageSize=20）', async () => {
      mockListQB.getRawAndEntities.mockResolvedValue({ entities: [], raw: [] })
      mockListQB.getCount.mockResolvedValue(0)

      const result = await service.findAll({} as any)

      expect(mockListQB.orderBy).toHaveBeenCalledWith('s.createdTime', 'DESC')
      expect(mockListQB.skip).toHaveBeenCalledWith(0)
      expect(mockListQB.take).toHaveBeenCalledWith(20)
      expect(result).toEqual({ list: [], total: 0, page: 1, pageSize: 20 })
    })
  })
})
