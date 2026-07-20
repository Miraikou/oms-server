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
import type { CreateSalesReturnDto, QuerySalesReturnDto } from '../dto/sales-return.dto'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

// ---- Mock Repositories ----
const mockReturnRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockReturnItemRepo = {
  find: jest.fn(),
}

// 事务中使用 manager，repos 仅用于 findOne / findAll
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
}

const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
}

// ---- Mock QueryBuilder ----
const mockQB = {
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
}

// ---- Mock Services ----
const mockSequenceService = {
  generate: jest.fn().mockResolvedValue('TH202601010001'),
}

const mockSalesOrderService = {}

const mockRateService = {
  getRate: jest.fn().mockResolvedValue('1'),
}

// ========== 测试数据 ==========
const mockOrder = {
  id: '202601010001',
  orderNo: 'SO202601010001',
  shipmentStatus: 3, // 已发货
}

const mockShipItem = {
  id: 'SI001',
  productId: 'P001',
  orderItemId: 'OI001',
  quantity: '10.0000',
}

const mockOrderItem = {
  id: 'OI001',
  returnedQuantity: '0.0000',
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
  availableQuantity: '0.0000',
  frozenQuantity: '0.0000',
  stockQuantity: '0.0000',
  status: 2, // 已耗尽
  version: 1,
}

const mockInventory = {
  id: 'INV001',
  productId: 'P001',
  availableQuantity: '0.0000',
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
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<SalesReturnService>(SalesReturnService)
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ============================================================
  //  create
  // ============================================================
  describe('create', () => {
    it('创建退货单成功并恢复库存（restoreInventory=1）', async () => {
      // 事务内 manager 调用顺序：
      //   1. findOne(SalesOrder)
      //   2. findOne(ShipmentItem)     —— 校验
      //   3. find(SalesReturnItem)     —— 查询已退数量
      //   4. create(SalesReturn)
      //   5. save(SalesReturn)
      //   6. findOne(ShipmentItem)     —— 创建明细取 productId
      //   7. create(SalesReturnItem)
      //   8. save(SalesReturnItem)
      //   9. find(ShipmentItemBatch)   —— 恢复批次库存
      //  10. findOne(InventoryBatch)
      //  11. save(InventoryBatch)
      //  12. findOne(Inventory)
      //  13. save(Inventory)
      //  14. create(InventoryFlow)
      //  15. save(InventoryFlow)
      //  16. findOne(SalesOrderItem)
      //  17. save(SalesOrderItem)
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)        // SalesOrder
        .mockResolvedValueOnce(mockShipItem)      // ShipmentItem 校验
        .mockResolvedValueOnce(mockShipItem)      // ShipmentItem 创建明细
        .mockResolvedValueOnce(mockInventoryBatch) // InventoryBatch 恢复
        .mockResolvedValueOnce(mockInventory)     // Inventory 汇总
        .mockResolvedValueOnce(mockOrderItem)     // SalesOrderItem 更新
      mockManager.find
        .mockResolvedValueOnce([])                // SalesReturnItem 无已退记录
        .mockResolvedValueOnce([mockShipBatch])   // ShipmentItemBatch 发货批次

      const result = await service.create(validDto)

      // 校验退货单号生成
      expect(mockSequenceService.generate).toHaveBeenCalledWith('TH')
      // 校验创建退货单
      expect(mockManager.create).toHaveBeenCalledWith(
        SalesReturn,
        expect.objectContaining({ returnNo: 'TH202601010001' }),
      )
      // 校验创建退货明细
      expect(mockManager.create).toHaveBeenCalledWith(
        SalesReturnItem,
        expect.objectContaining({ shipmentItemId: 'SI001' }),
      )
      // 校验创建库存流水（businessType=3 客户退货）
      expect(mockManager.create).toHaveBeenCalledWith(
        InventoryFlow,
        expect.objectContaining({ businessType: 3, changeType: 1 }),
      )
      // 校验批次库存恢复（available 从 0 → 5）
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ availableQuantity: '5.0000' }),
      )
      // 校验订单明细退货数量更新（returnedQuantity 从 0 → 5）
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ returnedQuantity: '5.0000' }),
      )
      // 校验返回结果
      expect(result.returnNo).toBe('TH202601010001')
    })

    it('创建退货单成功但不恢复库存（restoreInventory=0）', async () => {
      const dto = { ...validDto, restoreInventory: 0 }
      // 不走批次恢复流程，跳过 InventoryBatch/Inventory/InventoryFlow
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)        // SalesOrder
        .mockResolvedValueOnce(mockShipItem)      // ShipmentItem 校验
        .mockResolvedValueOnce(mockShipItem)      // ShipmentItem 创建明细
        .mockResolvedValueOnce(mockOrderItem)     // SalesOrderItem 更新
      mockManager.find
        .mockResolvedValueOnce([])                // SalesReturnItem 无已退记录

      const result = await service.create(dto)

      // 不应查询批次和库存
      expect(mockManager.find).toHaveBeenCalledTimes(1) // 仅 SalesReturnItem
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

    it('订单不存在应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce(null)

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException)
    })

    it('订单尚未发货应抛出 BadRequestException', async () => {
      // shipmentStatus < 2 表示未发货
      mockManager.findOne.mockResolvedValueOnce({
        ...mockOrder,
        shipmentStatus: 1,
      })

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException)
    })

    it('发货明细不存在应抛出 BadRequestException', async () => {
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)   // SalesOrder 存在
        .mockResolvedValueOnce(null)        // ShipmentItem 不存在

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException)
    })

    it('退货数量超过可退数量应抛出 BadRequestException', async () => {
      // shipmentItem.quantity = 10，已退 8，可退 2，请求退 5 则超过
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)            // SalesOrder
        .mockResolvedValueOnce(mockShipItem)          // ShipmentItem（quantity=10）
      mockManager.find
        .mockResolvedValueOnce([{ quantity: '8.0000' }]) // 已退 8

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  findOne
  // ============================================================
  describe('findOne', () => {
    it('存在应返回退货单及明细列表', async () => {
      const mockRet = { id: 'R001', returnNo: 'TH202601010001' }
      const mockItems = [
        { id: 'RI001', salesReturnId: 'R001', productId: 'P001' },
      ]
      mockReturnRepo.findOne.mockResolvedValue(mockRet)
      mockReturnItemRepo.find.mockResolvedValue(mockItems)

      const result = await service.findOne('R001')

      expect(result).toEqual({ ...mockRet, items: mockItems })
    })

    it('不存在应抛出 BadRequestException', async () => {
      mockReturnRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('R999')).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  findAll
  // ============================================================
  describe('findAll', () => {
    beforeEach(() => {
      mockReturnRepo.createQueryBuilder.mockReturnValue(mockQB)
    })

    it('按全部条件筛选应返回分页结果', async () => {
      const mockList = [{ id: 'R001', returnNo: 'TH202601010001' }]
      mockQB.getManyAndCount.mockResolvedValue([mockList, 1])

      const result = await service.findAll({
        returnNo: 'TH',
        orderId: '202601010001',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        page: 1,
        pageSize: 20,
      } as QuerySalesReturnDto)

      expect(mockQB.andWhere).toHaveBeenCalledTimes(4)
      expect(mockQB.orderBy).toHaveBeenCalledWith('r.createdTime', 'DESC')
      expect(result.list).toEqual(mockList)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })
})
