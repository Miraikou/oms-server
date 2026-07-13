import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { BadRequestException } from '@nestjs/common'
import { SalesOrderService } from '../sales-order.service'
import { SalesOrder } from '../entities/sales-order.entity'
import { SalesOrderItem } from '../entities/sales-order-item.entity'
import { SalesOrderCost } from '../entities/sales-order-cost.entity'
import { Inventory } from '@/modules/inventory/entities/inventory.entity'
import { CommonContact } from '@/modules/common-contact/entities/common-contact.entity'
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity'
import { CostType } from '@/modules/cost-type/entities/cost-type.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { FifoService } from '@/modules/inventory/services/fifo.service'
import { snowflake } from '@/common/utils/snowflake'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

// ---- Mock Repositories ----
const mockOrderRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  createQueryBuilder: jest.fn(),
  delete: jest.fn(),
}

const mockItemRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  delete: jest.fn(),
}

const mockInventoryRepo = {
  findOne: jest.fn(),
}

const mockContactRepo = {
  findOne: jest.fn(),
  create: jest.fn((_entity: any, data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
}

const mockShipmentItemRepo = {
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockCostRepo = {
  createQueryBuilder: jest.fn(),
}

const mockCostTypeRepo = {}

// ---- Mock QueryBuilder ----
const mockQB = {
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
}

// ---- Mock Manager for DataSource.transaction ----
const mockManager = {
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  create: jest.fn((_entity: any, data: any) => data),
  getRepository: jest.fn((): any => mockItemRepo),
}

const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
}

// ---- Mock Services ----
const mockSequenceService = { generate: jest.fn().mockResolvedValue('SO202601010001') }
const mockFifoService = {
  freeze: jest.fn(),
  unfreeze: jest.fn(),
}

describe('SalesOrderService', () => {
  let service: SalesOrderService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrderService,
        { provide: getRepositoryToken(SalesOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(SalesOrderItem), useValue: mockItemRepo },
        { provide: getRepositoryToken(Inventory), useValue: mockInventoryRepo },
        { provide: getRepositoryToken(CommonContact), useValue: mockContactRepo },
        { provide: getRepositoryToken(ShipmentItem), useValue: mockShipmentItemRepo },
        { provide: getRepositoryToken(SalesOrderCost), useValue: mockCostRepo },
        { provide: getRepositoryToken(CostType), useValue: mockCostTypeRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: FifoService, useValue: mockFifoService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<SalesOrderService>(SalesOrderService)
  })

  // ============================================================
  //  create
  // ============================================================
  describe('create', () => {
    const validDto = {
      salespersonId: '1001',
      customerName: '测试客户',
      orderDate: '2026-01-01',
      transportChannelId: '2001',
      tradeType: 'FOB',
      remark: '加急',
      items: [
        { productId: 'P001', quantity: '10', unitPrice: '50' },
      ],
    }

    const mockInventory = {
      productId: 'P001',
      availableQuantity: '100',
    }

    it('创建订单成功应返回订单并冻结库存', async () => {
      mockManager.findOne.mockResolvedValue(mockInventory)
      mockManager.save.mockImplementation((entity: any) => Promise.resolve({ ...entity, id: entity.id || 'new-id' }))
      mockContactRepo.findOne.mockResolvedValue(null)

      const result = await service.create(validDto)

      expect(mockSequenceService.generate).toHaveBeenCalledWith('SO')
      expect(snowflake.nextId).toHaveBeenCalled()
      expect(mockManager.save).toHaveBeenCalled()
      expect(mockFifoService.freeze).toHaveBeenCalledWith('P001', 10, expect.any(String))
      expect(result.orderNo).toBe('SO202601010001')
    })

    it('商品列表为空应抛出 BadRequestException', async () => {
      const dto = { ...validDto, items: [] }

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      expect(mockDataSource.transaction).not.toHaveBeenCalled()
    })

    it('商品数量小于等于0应抛出 BadRequestException', async () => {
      const dto = { ...validDto, items: [{ productId: 'P001', quantity: '0', unitPrice: '50' }] }

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
    })

    it('商品单价小于等于0应抛出 BadRequestException', async () => {
      const dto = { ...validDto, items: [{ productId: 'P001', quantity: '10', unitPrice: '0' }] }

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
    })

    it('商品无库存记录应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValue(null)

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException)
    })

    it('商品库存不足应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValue({ productId: 'P001', availableQuantity: '5' })

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException)
    })

    it('客户名为空不应 upsert 联系人', async () => {
      const dto = { ...validDto, customerName: '' }
      mockManager.findOne.mockResolvedValue(mockInventory)

      await service.create(dto)

      expect(mockManager.findOne).not.toHaveBeenCalledWith(
        CommonContact,
        expect.anything(),
      )
    })
  })

  // ============================================================
  //  findAll
  // ============================================================
  describe('findAll', () => {
    beforeEach(() => {
      mockOrderRepo.createQueryBuilder.mockReturnValue(mockQB)
    })

    it('按全部条件筛选应返回分页结果', async () => {
      const mockList = [{ id: '1', orderNo: 'SO2026' }]
      mockQB.getManyAndCount.mockResolvedValue([mockList, 1])

      const result = await service.findAll({
        orderNo: 'SO',
        status: 1,
        shipmentStatus: 2,
        paymentStatus: 1,
        salespersonId: '1001',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        page: 1,
        pageSize: 20,
        sortField: 'createdTime',
        sortOrder: 'DESC',
      })

      expect(mockQB.andWhere).toHaveBeenCalledTimes(7)
      expect(result.list).toEqual(mockList)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })

    it('默认分页参数应正常工作', async () => {
      mockQB.getManyAndCount.mockResolvedValue([[], 0])

      const result = await service.findAll({
        page: 1,
        pageSize: 20,
        sortField: 'createdTime',
        sortOrder: 'DESC',
      })

      expect(mockQB.skip).toHaveBeenCalledWith(0)
      expect(mockQB.take).toHaveBeenCalledWith(20)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })

  // ============================================================
  //  findOne
  // ============================================================
  describe('findOne', () => {
    it('存在应返回订单及明细', async () => {
      const mockOrder = { id: 'O001', orderNo: 'SO202601010001' }
      const mockItems = [{ id: 'I001', orderId: 'O001', productId: 'P001' }]
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockItemRepo.find.mockResolvedValue(mockItems)

      const result = await service.findOne('O001')

      expect(result).toEqual({ ...mockOrder, items: mockItems })
    })

    it('不存在应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('O999')).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  update
  // ============================================================
  describe('update', () => {
    const existingOrder = {
      id: 'O001',
      orderNo: 'SO202601010001',
      customerName: '旧客户',
      shipmentStatus: 1,
      totalAmount: '500',
      remark: '备注',
    }

    it('仅修改备注和客户名应成功', async () => {
      mockOrderRepo.findOne.mockResolvedValue(existingOrder)

      const result = await service.update('O001', {
        customerName: '新客户',
        remark: '新备注',
      })

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ customerName: '新客户', remark: '新备注' }),
      )
      expect(mockItemRepo.find).not.toHaveBeenCalled()
    })

    it('整体替换明细应成功', async () => {
      mockOrderRepo.findOne.mockResolvedValue(existingOrder)
      mockItemRepo.find.mockResolvedValue([
        { id: 'I001', productId: 'P001', quantity: '10', shippedQuantity: '0', orderId: 'O001' },
      ])
      mockInventoryRepo.findOne.mockResolvedValue({ productId: 'P002', availableQuantity: '100' })

      const result = await service.update('O001', {
        items: [{ productId: 'P002', quantity: '5', unitPrice: '100' }],
      })

      // 解冻旧商品
      expect(mockFifoService.unfreeze).toHaveBeenCalledWith('P001', 10, 'O001')
      // 删除旧明细
      expect(mockItemRepo.delete).toHaveBeenCalledWith({ orderId: 'O001' })
      // 检查新商品库存
      expect(mockInventoryRepo.findOne).toHaveBeenCalledWith({
        where: { productId: 'P002' },
      })
      // 冻结新商品
      expect(mockFifoService.freeze).toHaveBeenCalledWith('P002', 5, 'O001')
      // 保存新明细
      expect(mockItemRepo.save).toHaveBeenCalled()
      expect(result.totalAmount).toBe('500.00')
    })

    it('订单不存在应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.update('O999', { customerName: '新客户' })).rejects.toThrow(BadRequestException)
    })

    it('订单已发货不应修改应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue({ ...existingOrder, shipmentStatus: 2 })

      await expect(service.update('O001', { remark: '新备注' })).rejects.toThrow(BadRequestException)
    })

    it('新商品库存不足应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue(existingOrder)
      mockItemRepo.find.mockResolvedValue([
        { id: 'I001', productId: 'P001', quantity: '10', shippedQuantity: '0', orderId: 'O001' },
      ])
      mockInventoryRepo.findOne.mockResolvedValue({ productId: 'P002', availableQuantity: '2' })

      await expect(service.update('O001', {
        items: [{ productId: 'P002', quantity: '5', unitPrice: '100' }],
      })).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  cancel
  // ============================================================
  describe('cancel', () => {
    it('待发货订单取消成功并解冻全部库存', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 1,
        remark: '普通订单',
        receivedAmount: '0',
      })
      mockItemRepo.find.mockResolvedValue([
        { id: 'I001', productId: 'P001', quantity: '10', shippedQuantity: '0' },
      ])

      const result = await service.cancel('O001')

      expect(mockFifoService.unfreeze).toHaveBeenCalledWith('P001', 10, 'O001', mockManager)
      expect(result.order.status).toBe(3)
      expect(result.order.remark).toContain('[已取消]')
      expect(result.needsRefund).toBe(false)
    })

    it('部分发货订单取消成功并解冻剩余库存', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 2,
        remark: '部分发货',
        receivedAmount: '0',
      })
      mockItemRepo.find.mockResolvedValue([
        { id: 'I001', productId: 'P001', quantity: '10', shippedQuantity: '4' },
      ])

      await service.cancel('O001')

      // 应解冻 10 - 4 = 6
      expect(mockFifoService.unfreeze).toHaveBeenCalledWith('P001', 6, 'O001', mockManager)
    })

    it('已完成订单无法取消应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 2,
        shipmentStatus: 3,
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })

    it('全部发货订单无法取消应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 3,
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })

    it('已取消订单不可重复取消应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 3,
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })

    it('有已收金额的订单取消后应标记需要退款', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 1,
        remark: '已收款订单',
        receivedAmount: '500',
      })
      mockItemRepo.find.mockResolvedValue([
        { id: 'I001', productId: 'P001', quantity: '10', shippedQuantity: '0' },
      ])

      const result = await service.cancel('O001')

      expect(result.needsRefund).toBe(true)
      expect(result.refundableAmount).toBe('500')
    })
  })

  // ============================================================
  //  updateReceivedAmount
  // ============================================================
  describe('updateReceivedAmount', () => {
    it('更新金额成功并重新计算状态', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        totalAmount: '1000',
        receivedAmount: '200',
      })
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', shippedQuantity: '10' },
      ])

      await service.updateReceivedAmount('O001', '300')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          receivedAmount: '500.00',
        }),
      )
    })

    it('订单不存在应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.updateReceivedAmount('O999', '100')).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  updateShippedQuantity
  // ============================================================
  describe('updateShippedQuantity', () => {
    it('更新发货数量成功并重新计算状态', async () => {
      mockItemRepo.findOne.mockResolvedValue({
        id: 'I001',
        shippedQuantity: '5',
      })
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 2,
        totalAmount: '1000',
        receivedAmount: '1000',
      })
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', shippedQuantity: '10' },
      ])

      await service.updateShippedQuantity('O001', 'I001', 3)

      expect(mockItemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          shippedQuantity: '8.0000',
        }),
      )
    })

    it('明细不存在应抛出 BadRequestException', async () => {
      mockItemRepo.findOne.mockResolvedValue(null)

      await expect(service.updateShippedQuantity('O001', 'I999', 5)).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  recalculateStatus
  // ============================================================
  describe('recalculateStatus', () => {
    it('全部发货且已收款应标记为已完成', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 2,
        paymentStatus: 2,
        totalAmount: '1000',
        receivedAmount: '1000',
      })
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', shippedQuantity: '10' },
      ])

      await service.recalculateStatus('O001')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          shipmentStatus: 3,
          paymentStatus: 3,
          status: 2,
        }),
      )
    })

    it('部分发货应更新发货状态为部分发货', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 1,
        paymentStatus: 1,
        totalAmount: '1000',
        receivedAmount: '0',
      })
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', shippedQuantity: '3' },
      ])

      await service.recalculateStatus('O001')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ shipmentStatus: 2 }),
      )
    })

    it('部分收款应更新收款状态为部分收款', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 1,
        paymentStatus: 1,
        totalAmount: '1000',
        receivedAmount: '500',
      })
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', shippedQuantity: '0' },
      ])

      await service.recalculateStatus('O001')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: 2 }),
      )
    })

    it('订单已完成不应重复计算', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 2,
        shipmentStatus: 3,
        paymentStatus: 3,
        totalAmount: '1000',
        receivedAmount: '1000',
      })

      await service.recalculateStatus('O001')

      // 如果 status===2，方法会 return，不会查 items
      expect(mockItemRepo.find).not.toHaveBeenCalled()
      expect(mockOrderRepo.save).not.toHaveBeenCalled()
    })
  })
})
