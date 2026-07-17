import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { BadRequestException } from '@nestjs/common'
import { ShipmentService } from '../shipment.service'
import { Shipment } from '../entities/shipment.entity'
import { ShipmentItem } from '../entities/shipment-item.entity'
import { ShipmentItemBatch } from '../entities/shipment-item-batch.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity'
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { FifoService } from '@/modules/inventory/services/fifo.service'
import { SalesOrderService } from '@/modules/sales-order/sales-order.service'

// ─── 全局 Mock：Snowflake ID 生成 ─────────────────────────
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

// ─── Mock Repositories ─────────────────────────────────────
const mockShipmentRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockItemRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
}

const mockBatchRepo = {
  create: jest.fn(),
  save: jest.fn(),
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
}

// ─── Mock Services ─────────────────────────────────────────
const mockSequenceService = {
  generate: jest.fn(),
}

const mockFifoService = {
  deductFrozen: jest.fn(),
}

const mockSalesOrderService = {
  updateShippedQuantity: jest.fn(),
}

// ─── Mock QueryBuilder（链式调用） ─────────────────────────
function createMockQB() {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    getManyAndCount: jest.fn(),
  }
  return qb
}

describe('ShipmentService', () => {
  let service: ShipmentService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentService,
        { provide: getRepositoryToken(Shipment), useValue: mockShipmentRepo },
        { provide: getRepositoryToken(ShipmentItem), useValue: mockItemRepo },
        { provide: getRepositoryToken(ShipmentItemBatch), useValue: mockBatchRepo },
        { provide: getRepositoryToken(SalesOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(SalesOrderItem), useValue: mockOrderItemRepo },
        { provide: getRepositoryToken(InventoryBatch), useValue: mockInventoryBatchRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: FifoService, useValue: mockFifoService },
        { provide: SalesOrderService, useValue: mockSalesOrderService },
      ],
    }).compile()

    service = module.get<ShipmentService>(ShipmentService)
  })

  // ═══════════════════════════════════════════════════════════
  // create - 创建发货单
  // ═══════════════════════════════════════════════════════════
  describe('create', () => {
    const dto = {
      orderId: 'order-1',
      expressCompanyId: 'express-1',
      trackingNo: 'SF1234567890',
      shipmentDate: '2026-07-01',
      remark: '快件发运',
      items: [{ orderItemId: 'orderItem-1', quantity: '10' }],
    }

    const mockOrder = {
      id: 'order-1',
      orderNo: 'ORD20260700001',
      customerName: '测试客户',
      status: 1,
      shipmentStatus: 1,
    }

    const mockOrderItems = [
      {
        id: 'orderItem-1',
        orderId: 'order-1',
        productId: 'prod-1',
        quantity: '20',
        shippedQuantity: '0',
        unitPriceUsd: '100.00',
      },
    ]

    const mockFifoResult = {
      items: [
        { batchId: 'b1', quantity: 10, unitCostUsd: '50.00', totalCostUsd: '500.00' },
      ],
      totalCostUsd: '500.00',
    }

    const savedShipment = {
      id: '9999999999999999',
      shipmentNo: 'FH202601010001',
      orderId: 'order-1',
      expressCompanyId: 'express-1',
      trackingNo: 'SF1234567890',
      shipmentDate: new Date('2026-07-01'),
      status: 1,
      remark: '快件发运',
    }

    it('应成功创建发货单（明细、FIFO 扣减、批次、订单更新）', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue(mockOrderItems)
      mockSequenceService.generate.mockResolvedValue('FH202601010001')
      mockShipmentRepo.create.mockImplementation((data: any) => ({ ...data }))
      mockShipmentRepo.save.mockImplementation((entity: any) => Promise.resolve({ ...entity }))
      mockItemRepo.create.mockImplementation((data: any) => ({ ...data }))
      mockItemRepo.save.mockImplementation((entity: any) => Promise.resolve({ ...entity }))
      mockFifoService.deductFrozen.mockResolvedValue(mockFifoResult)
      mockBatchRepo.create.mockImplementation((data: any) => ({ ...data }))
      mockBatchRepo.save.mockImplementation((entity: any) => Promise.resolve(entity))

      const result = await service.create(dto)

      // 校验订单和明细
      expect(mockOrderRepo.findOne).toHaveBeenCalledWith({ where: { id: 'order-1' } })
      expect(mockOrderItemRepo.find).toHaveBeenCalledWith({ where: { orderId: 'order-1' } })

      // 校验发货单号生成
      expect(mockSequenceService.generate).toHaveBeenCalledWith('FH')

      // 校验发货单创建
      expect(mockShipmentRepo.create).toHaveBeenCalledWith({
        id: '9999999999999999',
        shipmentNo: 'FH202601010001',
        orderId: 'order-1',
        expressCompanyId: 'express-1',
        trackingNo: 'SF1234567890',
        shipmentDate: expect.any(Date),
        status: 1,
        remark: '快件发运',
      })

      // 校验明细项创建（salesAmount = 10 * 100.00 = 1000.00）
      expect(mockItemRepo.create).toHaveBeenCalledWith({
        id: '9999999999999999',
        shipmentId: '9999999999999999',
        orderItemId: 'orderItem-1',
        productId: 'prod-1',
        quantity: '10',
        salesUnitPriceUsd: '100.00',
        salesAmountUsd: '1000.00',
        totalCostCny: '0',
        grossProfitCny: '0',
      })

      // 校验 save 调用 2 次（创建 + 更新成本/利润）
      expect(mockItemRepo.save).toHaveBeenCalledTimes(2)

      // FIFO 扣减冻结库存
      expect(mockFifoService.deductFrozen).toHaveBeenCalledWith('prod-1', 10, '9999999999999999', 2)

      // 校验批次表创建
      expect(mockBatchRepo.create).toHaveBeenCalledWith({
        id: '9999999999999999',
        shipmentItemId: '9999999999999999',
        inventoryBatchId: 'b1',
        quantity: '10',
        unitCostUsd: '50.00',
        totalCostUsd: '500.00',
      })

      // 校验成本/利润更新（第二次 save）
      expect(mockItemRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          totalCostCny: '500.00',
          grossProfitCny: '500.00',
        }),
      )

      // 校验订单已发数量更新
      expect(mockSalesOrderService.updateShippedQuantity).toHaveBeenCalledWith(
        'order-1', 'orderItem-1', 10,
      )

      // 返回发货单
      expect(result).toEqual(expect.objectContaining({
        shipmentNo: 'FH202601010001',
        orderId: 'order-1',
      }))
    })

    it('发货明细为空时应抛出异常', async () => {
      const emptyDto = { ...dto, items: [] }

      await expect(service.create(emptyDto)).rejects.toThrow(BadRequestException)
      await expect(service.create(emptyDto)).rejects.toThrow('发货明细不能为空')
    })

    it('订单不存在时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      await expect(service.create(dto)).rejects.toThrow('订单不存在')
    })

    it('订单状态非进行中（status !== 1）时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue({ ...mockOrder, status: 2 })

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      await expect(service.create(dto)).rejects.toThrow('订单已结束，无法发货')
    })

    it('订单已全部发货（shipmentStatus === 3）时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue({ ...mockOrder, shipmentStatus: 3 })

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      await expect(service.create(dto)).rejects.toThrow('订单已全部发货，无法再次发货')
    })

    it('订单明细 ID 不存在时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue(mockOrderItems)
      const badDto = {
        ...dto,
        items: [{ orderItemId: 'nonexistent-item', quantity: '10' }],
      }

      await expect(service.create(badDto)).rejects.toThrow(BadRequestException)
      await expect(service.create(badDto)).rejects.toThrow('订单明细 nonexistent-item 不存在')
    })

    it('发货数量超过可发数量时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue(mockOrderItems)
      const exceedDto = {
        ...dto,
        items: [{ orderItemId: 'orderItem-1', quantity: '30' }],
      }

      await expect(service.create(exceedDto)).rejects.toThrow(BadRequestException)
      await expect(service.create(exceedDto)).rejects.toThrow('发货数量 30 超过可发数量 20')
    })
  })

  // ═══════════════════════════════════════════════════════════
  // preview - 发货预览
  // ═══════════════════════════════════════════════════════════
  describe('preview', () => {
    const mockOrder = {
      id: 'order-1',
      orderNo: 'ORD20260700001',
      customerName: '测试客户',
    }

    const mockOrderItems = [
      {
        id: 'orderItem-1',
        productId: 'prod-1',
        quantity: '20',
        shippedQuantity: '5',
        unitPriceUsd: '100.00',
      },
      {
        id: 'orderItem-2',
        productId: 'prod-2',
        quantity: '10',
        shippedQuantity: '10',
        unitPriceUsd: '50.00',
      },
    ]

    it('应返回包含剩余数量和 FIFO 预估批次的结果', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue(mockOrderItems)

      const mockQB = createMockQB()
      mockQB.getMany.mockResolvedValue([
        {
          id: 'b1',
          batchNo: 'BT001',
          productId: 'prod-1',
          unitCostUsd: '50.00',
          frozenQuantity: '20',
          inboundTime: new Date('2026-01-01'),
        },
      ])
      mockInventoryBatchRepo.createQueryBuilder.mockReturnValue(mockQB)

      const result = await service.preview('order-1')

      expect(result.orderId).toBe('order-1')
      expect(result.orderNo).toBe('ORD20260700001')
      expect(result.customerName).toBe('测试客户')

      // 仅包含有剩余数量的明细（orderItem-1: 剩余 15，orderItem-2: 剩余 0 被跳过）
      expect(result.items).toHaveLength(1)
      expect(result.items[0].orderItemId).toBe('orderItem-1')
      expect(result.items[0].remainingQuantity).toBe(15)
      expect(result.items[0].batches).toHaveLength(1)
      expect(result.items[0].batches[0].batchId).toBe('b1')
      expect(result.items[0].batches[0].quantity).toBe(15) // min(frozen=20, need=15)
      expect(result.items[0].batches[0].totalCost).toBe('750.00') // 15 * 50
      expect(result.items[0].estimatedCost).toBe('750.00')
    })

    it('所有明细无剩余数量时应跳过', async () => {
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockOrderItemRepo.find.mockResolvedValue([
        { id: 'item-1', productId: 'prod-1', quantity: '10', shippedQuantity: '10', unitPriceUsd: '100.00' },
      ])

      const result = await service.preview('order-1')

      expect(result.items).toHaveLength(0)
    })

    it('订单不存在时应抛出异常', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.preview('nonexistent')).rejects.toThrow(BadRequestException)
      await expect(service.preview('nonexistent')).rejects.toThrow('订单不存在')
    })
  })

  // ═══════════════════════════════════════════════════════════
  // findOne - 查询发货单详情（聚合）
  // ═══════════════════════════════════════════════════════════
  describe('findOne', () => {
    const mockShipment = {
      id: 'shipment-1',
      shipmentNo: 'FH20260700001',
      orderId: 'order-1',
    }

    const mockItems = [
      { id: 'item-1', shipmentId: 'shipment-1', orderItemId: 'orderItem-1', productId: 'prod-1' },
      { id: 'item-2', shipmentId: 'shipment-1', orderItemId: 'orderItem-2', productId: 'prod-2' },
    ]

    const mockBatchesForItem1 = [
      { id: 'batch-1', shipmentItemId: 'item-1', inventoryBatchId: 'b1', quantity: '10', unitCostUsd: '50.00', totalCostUsd: '500.00' },
    ]

    const mockBatchesForItem2: any[] = []

    it('应返回发货单及明细和批次信息', async () => {
      mockShipmentRepo.findOne.mockResolvedValue(mockShipment)
      mockItemRepo.find.mockResolvedValue(mockItems)
      mockBatchRepo.find
        .mockResolvedValueOnce(mockBatchesForItem1)
        .mockResolvedValueOnce(mockBatchesForItem2)

      const result = await service.findOne('shipment-1')

      expect(result.id).toBe('shipment-1')
      expect(result.shipmentNo).toBe('FH20260700001')
      expect(result.items).toHaveLength(2)

      // item-1 有批次
      expect(result.items[0].id).toBe('item-1')
      expect(result.items[0].batches).toHaveLength(1)
      expect(result.items[0].batches[0].inventoryBatchId).toBe('b1')

      // item-2 无批次
      expect(result.items[1].id).toBe('item-2')
      expect(result.items[1].batches).toHaveLength(0)
    })

    it('发货单不存在时应抛出异常', async () => {
      mockShipmentRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('nonexistent')).rejects.toThrow(BadRequestException)
      await expect(service.findOne('nonexistent')).rejects.toThrow('发货单不存在')
    })
  })

  // ═══════════════════════════════════════════════════════════
  // findAll - 分页查询发货单列表
  // ═══════════════════════════════════════════════════════════
  describe('findAll', () => {
    it('应按筛选条件分页查询', async () => {
      const mockQB = createMockQB()
      mockQB.getManyAndCount.mockResolvedValue([
        [{ id: 's-1', shipmentNo: 'FH20260700001' }],
        1,
      ])
      mockShipmentRepo.createQueryBuilder.mockReturnValue(mockQB)

      const query = {
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
      }

      const result = await service.findAll(query)

      expect(mockShipmentRepo.createQueryBuilder).toHaveBeenCalledWith('s')
      // 6 个 andWhere 条件
      expect(mockQB.andWhere).toHaveBeenCalledTimes(6)
      expect(mockQB.orderBy).toHaveBeenCalledWith('s.createdTime', 'DESC')
      expect(mockQB.skip).toHaveBeenCalledWith(0)
      expect(mockQB.take).toHaveBeenCalledWith(10)
      expect(result).toEqual({
        list: [{ id: 's-1', shipmentNo: 'FH20260700001' }],
        total: 1,
        page: 1,
        pageSize: 10,
      })
    })

    it('未传参数时应使用默认分页（page=1, pageSize=20）', async () => {
      const mockQB = createMockQB()
      mockQB.getManyAndCount.mockResolvedValue([[], 0])
      mockShipmentRepo.createQueryBuilder.mockReturnValue(mockQB)

      const result = await service.findAll({} as any)

      expect(mockQB.orderBy).toHaveBeenCalledWith('s.createdTime', 'DESC')
      expect(mockQB.skip).toHaveBeenCalledWith(0)
      expect(mockQB.take).toHaveBeenCalledWith(20)
      expect(result).toEqual({ list: [], total: 0, page: 1, pageSize: 20 })
    })
  })
})
