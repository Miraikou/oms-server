import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { BadRequestException } from '@nestjs/common'
import { SalesReturnService } from '../sales-return.service'
import { SalesReturn } from '../entities/sales-return.entity'
import { SalesReturnItem } from '../entities/sales-return-item.entity'
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity'
import { ShipmentItemBatch } from '@/modules/shipment/entities/shipment-item-batch.entity'
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity'
import { Inventory } from '@/modules/inventory/entities/inventory.entity'
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity'
import { Payment } from '@/modules/payment/entities/payment.entity'
import { SalesOrderCost } from '@/modules/sales-order/entities/sales-order-cost.entity'
import { CostType } from '@/modules/cost-type/entities/cost-type.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { SalesOrderService } from '@/modules/sales-order/sales-order.service'
import { RateService } from '@/common/rate/rate.service'
import { CommissionService } from '@/modules/commission/commission.service'
import type { CreateSalesReturnDto, QuerySalesReturnDto } from '../dto/sales-return.dto'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

/** 创建链式 QueryBuilder mock（manager.createQueryBuilder 用） */
function createQB() {
  return {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
  }
}

// ---- Mock Repositories（仅 findOne / findAll / 非事务路径使用） ----
const mockReturnRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockReturnItemRepo = {
  find: jest.fn(),
}

// 事务中使用 manager，repos 仅作 DI 占位
const mockShipmentItemRepo = {}
const mockShipmentBatchRepo = {}
const mockInventoryBatchRepo = {}
const mockInventoryRepo = {}
const mockFlowRepo = {}
const mockOrderRepo = {}
const mockOrderItemRepo = {}

// ---- Mock Manager for DataSource.transaction ----
const mockManager = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((_entity: any, data: any) => ({
    id: '9999999999999999',
    ...data,
  })),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  createQueryBuilder: jest.fn(),
}

// ---- Mock DataSource（transaction + 原生联表查询） ----
const mockDataSourceQB = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(),
  getRawMany: jest.fn().mockResolvedValue([]),
}

const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
  createQueryBuilder: jest.fn(() => mockDataSourceQB),
}

// ---- Mock Services ----
const mockSequenceService = {
  generate: jest.fn().mockResolvedValue('TH202601010001'),
}

const mockSalesOrderService = {
  recalculateStatus: jest.fn().mockResolvedValue(undefined),
  increaseRefundedAmount: jest.fn().mockResolvedValue(undefined),
}

const mockRateService = {
  getRate: jest.fn().mockResolvedValue('7.0000'),
  getDefaultRate: jest.fn().mockReturnValue('7.0000'),
}

const mockCommissionService = {
  accrueOrderCommission: jest.fn().mockResolvedValue(undefined),
  revokeOrderCommission: jest.fn().mockResolvedValue(undefined),
  recalculateOrderCommission: jest.fn().mockResolvedValue(undefined),
}

// ---- 事务内各实体对应的 QueryBuilder（每个测试重建，避免状态泄漏） ----
let orderItemQB: ReturnType<typeof createQB> // SalesOrderItem（归属校验 + 更新）
let returnItemQB: ReturnType<typeof createQB> // SalesReturnItem（历史退货）
let orderQB: ReturnType<typeof createQB> // SalesOrder（加锁重验）
let batchQB: ReturnType<typeof createQB> // InventoryBatch（恢复批次）
let inventoryQB: ReturnType<typeof createQB> // Inventory（恢复汇总）

// ========== 测试数据 ==========
const mockOrder = {
  id: '202601010001',
  orderNo: 'SO202601010001',
  status: 1, // 进行中
  shipmentStatus: 3, // 已发货
  currency: 'USD',
  exchangeRate: '7.0000',
  salespersonId: null,
}

// step 8 重算后的订单（仍为进行中，不触发提成逻辑）
const mockUpdatedOrder = {
  id: '202601010001',
  status: 1,
  salespersonId: null,
}

const mockShipItem = {
  id: 'SI001',
  productId: 'P001',
  productModelId: null,
  orderItemId: 'OI001',
  quantity: '10.0000',
  totalCostCny: '3500.00',
  totalCostUsd: '500.00',
  salesAmountCny: '7000.00',
  salesAmountUsd: '1000.00',
}

// 归属校验返回的订单明细（orderId 必须与退货订单一致）
const mockOwnerItem = {
  id: 'OI001',
  orderId: '202601010001',
}

const mockOrderItem = {
  id: 'OI001',
  orderId: '202601010001',
  returnedQuantity: '0.0000',
  refundReturnedQuantity: '0.0000',
}

const mockShipBatch = {
  id: 'SB001',
  shipmentItemId: 'SI001',
  inventoryBatchId: 'IB001',
  quantity: '10.0000',
  unitCostUsd: '50.0000',
  unitCostCny: '350.0000',
  totalCostUsd: '500.0000',
  totalCostCny: '3500.0000',
  currency: 'USD',
  exchangeRate: '7.0000',
}

const mockInventoryBatch = {
  id: 'IB001',
  productModelId: null,
  availableQuantity: '0.0000',
  frozenQuantity: '0.0000',
  stockQuantity: '0.0000',
  status: 2, // 已耗尽
  freezeStatus: 0,
  version: 1,
}

const mockInventory = {
  id: 'INV001',
  productId: 'P001',
  productModelId: null,
  availableQuantity: '0.0000',
  frozenQuantity: '0.0000',
  stockQuantity: '0.0000',
  version: 1,
}

const validDto: CreateSalesReturnDto = {
  orderId: '202601010001',
  returnDate: '2026-01-15',
  restoreInventory: 1,
  returnType: 1,
  reason: '质量问题',
  remark: undefined,
  refund: false,
  items: [{ shipmentItemId: 'SI001', quantity: '5' }],
}

describe('SalesReturnService', () => {
  let service: SalesReturnService

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesReturnService,
        { provide: getRepositoryToken(SalesReturn), useValue: mockReturnRepo },
        { provide: getRepositoryToken(SalesReturnItem), useValue: mockReturnItemRepo },
        { provide: getRepositoryToken(ShipmentItem), useValue: mockShipmentItemRepo },
        { provide: getRepositoryToken(ShipmentItemBatch), useValue: mockShipmentBatchRepo },
        { provide: getRepositoryToken(InventoryBatch), useValue: mockInventoryBatchRepo },
        { provide: getRepositoryToken(Inventory), useValue: mockInventoryRepo },
        { provide: getRepositoryToken(InventoryFlow), useValue: mockFlowRepo },
        { provide: getRepositoryToken(SalesOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(SalesOrderItem), useValue: mockOrderItemRepo },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(SalesOrderCost), useValue: {} },
        { provide: getRepositoryToken(CostType), useValue: {} },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: SalesOrderService, useValue: mockSalesOrderService },
        { provide: RateService, useValue: mockRateService },
        { provide: CommissionService, useValue: mockCommissionService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<SalesReturnService>(SalesReturnService)
  })

  beforeEach(() => {
    jest.clearAllMocks()

    // 每个测试重建各实体 QB，并按实体路由 manager.createQueryBuilder
    orderItemQB = createQB()
    returnItemQB = createQB()
    orderQB = createQB()
    batchQB = createQB()
    inventoryQB = createQB()

    mockManager.createQueryBuilder.mockImplementation((entity: any) => {
      if (entity === SalesOrderItem) return orderItemQB
      if (entity === SalesReturnItem) return returnItemQB
      if (entity === SalesOrder) return orderQB
      if (entity === InventoryBatch) return batchQB
      if (entity === Inventory) return inventoryQB
      return createQB()
    })

    mockSequenceService.generate.mockResolvedValue('TH202601010001')
  })

  // ============================================================
  //  create
  // ============================================================
  describe('create', () => {
    it('创建退货单成功并恢复库存到可用（restoreInventory=1，无预留模型）', async () => {
      // findOne 序列：step1 校验订单 → step8 重算后回读订单
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder) // step1 SalesOrder
        .mockResolvedValueOnce(mockUpdatedOrder) // step8 SalesOrder
      // find 序列：step2 预取发货明细 → step6 恢复批次
      mockManager.find
        .mockResolvedValueOnce([mockShipItem]) // step2 ShipmentItem
        .mockResolvedValueOnce([mockShipBatch]) // step6 ShipmentItemBatch
      // QB：归属校验 → 历史退货 → 加锁订单 → 批次 → 汇总 → 订单明细更新
      orderItemQB.getOne
        .mockResolvedValueOnce(mockOwnerItem) // 归属校验
        .mockResolvedValueOnce(mockOrderItem) // step5 更新 returnedQuantity
      returnItemQB.getMany.mockResolvedValueOnce([]) // 无历史退货
      orderQB.getOne.mockResolvedValueOnce(mockOrder) // step4 加锁重验
      batchQB.getOne.mockResolvedValueOnce(mockInventoryBatch) // 恢复批次
      inventoryQB.getOne.mockResolvedValueOnce(mockInventory) // 恢复汇总

      const result = await service.create(validDto)

      // 退货单号生成
      expect(mockSequenceService.generate).toHaveBeenCalledWith('TH')
      // 创建退货单
      expect(mockManager.create).toHaveBeenCalledWith(
        SalesReturn,
        expect.objectContaining({ returnNo: 'TH202601010001', returnType: 1 }),
      )
      // 创建退货明细
      expect(mockManager.create).toHaveBeenCalledWith(
        SalesReturnItem,
        expect.objectContaining({ shipmentItemId: 'SI001', quantity: '5' }),
      )
      // 创建库存流水（businessType=3 客户退货，changeType=1 入库）
      expect(mockManager.create).toHaveBeenCalledWith(
        InventoryFlow,
        expect.objectContaining({
          businessType: 3,
          changeType: 1,
          quantity: '5',
          afterAvailable: '5.0000',
          afterFrozen: '0.0000',
        }),
      )
      // ⭐ 无预留模型核心断言：退回的货恢复到【可用库存】而非冻结库存
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'IB001',
          availableQuantity: '5.0000',
          stockQuantity: '5.0000',
          frozenQuantity: '0.0000', // 冻结量不变
          status: 1, // 耗尽批次恢复为有效
        }),
      )
      // 库存汇总同样恢复到可用
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'INV001',
          availableQuantity: '5.0000',
          stockQuantity: '5.0000',
        }),
      )
      // 订单明细退货数量更新（returnedQuantity 0 → 5，退货退款累加 refundReturnedQuantity）
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'OI001',
          returnedQuantity: '5.0000',
          refundReturnedQuantity: '5.0000',
        }),
      )
      // 重算订单三维状态
      expect(mockSalesOrderService.recalculateStatus).toHaveBeenCalledWith(
        '202601010001',
        mockManager,
      )
      expect(result.returnNo).toBe('TH202601010001')
    })

    it('创建退货单成功但不恢复库存（restoreInventory=0）', async () => {
      const dto = { ...validDto, restoreInventory: 0 }
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(mockUpdatedOrder)
      // 不走批次恢复，find 仅 step2 一次
      mockManager.find.mockResolvedValueOnce([mockShipItem])
      orderItemQB.getOne
        .mockResolvedValueOnce(mockOwnerItem)
        .mockResolvedValueOnce(mockOrderItem)
      returnItemQB.getMany.mockResolvedValueOnce([])
      orderQB.getOne.mockResolvedValueOnce(mockOrder)

      const result = await service.create(dto)

      // 不应查询/恢复批次与库存汇总
      expect(batchQB.getOne).not.toHaveBeenCalled()
      expect(inventoryQB.getOne).not.toHaveBeenCalled()
      // 不应创建库存流水
      expect(mockManager.create).not.toHaveBeenCalledWith(
        InventoryFlow,
        expect.anything(),
      )
      expect(result.returnNo).toBe('TH202601010001')
    })

    it('仅退款（returnType=3）累加 refundOnlyQuantity 且不恢复库存、不计入已退货', async () => {
      const dto = { ...validDto, returnType: 3, refund: false, restoreInventory: 1 }
      // 使用独立的订单明细对象，避免与其他用例共享可变状态
      const freshOrderItem = {
        id: 'OI001',
        orderId: '202601010001',
        returnedQuantity: '0.0000',
        refundReturnedQuantity: '0.0000',
        refundOnlyQuantity: '0.0000',
      }
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder) // step1 SalesOrder
        .mockResolvedValueOnce(mockUpdatedOrder) // step8 SalesOrder
      // 仅退款不恢复库存，find 仅 step2 一次
      mockManager.find.mockResolvedValueOnce([mockShipItem])
      orderItemQB.getOne
        .mockResolvedValueOnce(mockOwnerItem) // 归属校验
        .mockResolvedValueOnce(freshOrderItem) // step5 更新 refundOnlyQuantity
      returnItemQB.getMany.mockResolvedValueOnce([]) // 无历史退货
      orderQB.getOne.mockResolvedValueOnce(mockOrder) // step3 加锁重验

      const result = await service.create(dto)

      // ⭐ 仅退款核心断言：累加 refundOnlyQuantity，returnedQuantity 保持不变
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'OI001',
          refundOnlyQuantity: '5.0000',
          returnedQuantity: '0.0000', // 实物未退回，已退货不变
        }),
      )
      // 仅退款不恢复库存（即使 restoreInventory=1）
      expect(batchQB.getOne).not.toHaveBeenCalled()
      expect(inventoryQB.getOne).not.toHaveBeenCalled()
      // 不创建库存流水
      expect(mockManager.create).not.toHaveBeenCalledWith(
        InventoryFlow,
        expect.anything(),
      )
      expect(result.returnNo).toBe('TH202601010001')
    })

    it('退货明细为空应抛出 BadRequestException', async () => {
      const dto = { ...validDto, items: [] }

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      // 前置校验失败，不应开启事务
      expect(mockDataSource.transaction).not.toHaveBeenCalled()
    })

    it('退货明细存在重复发货明细项应抛出 BadRequestException', async () => {
      const dto = {
        ...validDto,
        items: [
          { shipmentItemId: 'SI001', quantity: '2' },
          { shipmentItemId: 'SI001', quantity: '3' },
        ],
      }

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      expect(mockDataSource.transaction).not.toHaveBeenCalled()
    })

    it('退货换货/补发勾选退款应抛出 BadRequestException', async () => {
      await expect(
        service.create({ ...validDto, returnType: 2, refund: true }),
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.create({ ...validDto, returnType: 4, refund: true }),
      ).rejects.toThrow(BadRequestException)
    })

    it('订单不存在应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce(null)

      await expect(service.create(validDto)).rejects.toThrow('订单不存在')
    })

    it('已取消订单应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce({ ...mockOrder, status: 3 })

      await expect(service.create(validDto)).rejects.toThrow('已取消订单无法退货')
    })

    it('订单尚未发货应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce({ ...mockOrder, shipmentStatus: 1 })

      await expect(service.create(validDto)).rejects.toThrow('订单尚未发货，无法退货')
    })

    it('发货明细不存在应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce(mockOrder) // step1 订单存在
      mockManager.find.mockResolvedValueOnce([]) // step2 未找到发货明细

      await expect(service.create(validDto)).rejects.toThrow('发货明细 SI001 不存在')
    })

    it('发货明细不属于当前订单应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce(mockOrder) // step1 订单存在
      mockManager.find.mockResolvedValueOnce([mockShipItem])
      // 归属校验返回的订单明细 orderId 不匹配
      orderItemQB.getOne.mockResolvedValueOnce({ id: 'OI001', orderId: 'OTHER_ORDER' })

      await expect(service.create(validDto)).rejects.toThrow('不属于订单')
    })

    it('退货数量超过可退数量应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce(mockOrder) // step1 订单存在
      mockManager.find.mockResolvedValueOnce([mockShipItem]) // quantity=10
      orderItemQB.getOne.mockResolvedValueOnce(mockOwnerItem)
      returnItemQB.getMany.mockResolvedValueOnce([{ quantity: '8.0000' }]) // 已退 8，可退 2

      await expect(service.create(validDto)).rejects.toThrow('超过可退数量')
    })
  })

  // ============================================================
  //  findOne
  // ============================================================
  describe('findOne', () => {
    it('存在应返回退货单及补充后的明细列表', async () => {
      const mockRet = { id: 'R001', returnNo: 'TH202601010001', orderId: 'O1' }
      const mockItems = [
        { id: 'RI001', salesReturnId: 'R001', productId: 'P001', productModelId: null, shipmentItemId: 'SI001' },
      ]
      mockReturnRepo.findOne.mockResolvedValue(mockRet)
      mockReturnItemRepo.find.mockResolvedValue(mockItems)

      // dataSource 原生查询序列：order → products → shipItems → shipments（无型号，跳过 models）
      mockDataSourceQB.getRawOne.mockResolvedValueOnce({ order_no: 'SO001', currency: 'USD' })
      mockDataSourceQB.getRawMany
        .mockResolvedValueOnce([{ id: 'P001', product_name: '商品A' }]) // products
        .mockResolvedValueOnce([
          { id: 'SI001', sales_unit_price_usd: '100.00', sales_unit_price_cny: '700.00', currency: 'USD', shipment_id: 'SH1' },
        ]) // shipItems
        .mockResolvedValueOnce([{ id: 'SH1', shipment_no: 'FH001' }]) // shipments

      const result = await service.findOne('R001')

      expect(result.orderNo).toBe('SO001')
      expect(result.currency).toBe('USD')
      expect(result.items).toHaveLength(1)
      expect(result.items[0].productName).toBe('商品A')
      expect(result.items[0].salesUnitPriceUsd).toBe('100.00')
      expect(result.items[0].shipmentNo).toBe('FH001')
    })

    it('不存在应抛出 BadRequestException', async () => {
      mockReturnRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('R999')).rejects.toThrow('退货单不存在')
    })
  })

  // ============================================================
  //  findAll
  // ============================================================
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
      mockReturnRepo.createQueryBuilder.mockReturnValue(mockListQB)
    })

    it('按全部条件筛选应返回分页结果', async () => {
      const mockEntity = { id: 'R001', returnNo: 'TH202601010001' }
      mockListQB.getRawAndEntities.mockResolvedValue({
        entities: [mockEntity],
        raw: [{ orderNo: 'SO001', currency: 'USD' }],
      })
      mockListQB.getCount.mockResolvedValue(1)

      const result = await service.findAll({
        returnNo: 'TH',
        orderId: '202601010001',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        page: 1,
        pageSize: 20,
      } as QuerySalesReturnDto)

      // returnNo / orderId / startDate / endDate 共 4 个 andWhere
      expect(mockListQB.andWhere).toHaveBeenCalledTimes(4)
      expect(mockListQB.orderBy).toHaveBeenCalledWith('r.createdTime', 'DESC')
      expect(result.list).toEqual([{ ...mockEntity, orderNo: 'SO001', currency: 'USD' }])
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })
})
