import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { SystemConfigService } from '@/modules/system-config/system-config.service'
import { BadRequestException } from '@nestjs/common'
import { SalesOrderService } from '../sales-order.service'
import { SalesOrder } from '../entities/sales-order.entity'
import { SalesOrderItem } from '../entities/sales-order-item.entity'
import { SalesOrderCost } from '../entities/sales-order-cost.entity'
import { CommonContact } from '@/modules/common-contact/entities/common-contact.entity'
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity'
import { CostType } from '@/modules/cost-type/entities/cost-type.entity'
import { Payment } from '@/modules/payment/entities/payment.entity'
import { ProductModel } from '@/modules/product/entities/product-model.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { RateService } from '@/common/rate/rate.service'
import { CommissionService } from '@/modules/commission/commission.service'

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

const mockCostTypeRepo = {
  find: jest.fn(),
  create: jest.fn((data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
}

const mockPaymentRepo = {
  create: jest.fn((data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
}

const mockProductModelRepo = {
  find: jest.fn(),
}

// ---- Mock QueryBuilder（findAll 使用）----
const mockQB = {
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
}

// ---- Mock Manager for DataSource.transaction ----
// manager 级 QueryBuilder（cancel/terminate 的悲观锁链 createQueryBuilder().setLock().where().getOne()）
let mockManagerQB: any

const mockManager = {
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  create: jest.fn((_entity: any, data: any) => data),
  getRepository: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
  query: jest.fn().mockResolvedValue([]),
}

// ---- Mock Services ----
const mockSequenceService = { generate: jest.fn().mockResolvedValue('SO202601010001') }
const mockRateService = {
  getRate: jest.fn().mockResolvedValue('7.12'),
  getDefaultRate: jest.fn().mockReturnValue('7.12'),
}
const mockCommissionService = {
  accrueOrderCommission: jest.fn(),
  revokeOrderCommission: jest.fn(),
  recalculateOrderCommission: jest.fn(),
}
const mockSystemConfigService = { getByKey: jest.fn().mockResolvedValue('40') }

describe('SalesOrderService', () => {
  let service: SalesOrderService

  beforeEach(async () => {
    jest.clearAllMocks()

    // manager.getRepository 按实体路由到对应 mock 仓储
    mockManager.getRepository.mockImplementation((entity: any) => {
      if (entity === SalesOrder) return mockOrderRepo
      if (entity === SalesOrderItem) return mockItemRepo
      if (entity === SalesOrderCost) return mockCostRepo
      if (entity === Payment) return mockPaymentRepo
      return mockItemRepo
    })

    // 重建 manager 级 QueryBuilder，避免测试间串扰
    mockManagerQB = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn().mockResolvedValue([]),
    }
    mockManager.createQueryBuilder.mockReturnValue(mockManagerQB)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrderService,
        { provide: getRepositoryToken(SalesOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(SalesOrderItem), useValue: mockItemRepo },
        { provide: getRepositoryToken(CommonContact), useValue: mockContactRepo },
        { provide: getRepositoryToken(ShipmentItem), useValue: mockShipmentItemRepo },
        { provide: getRepositoryToken(SalesOrderCost), useValue: mockCostRepo },
        { provide: getRepositoryToken(CostType), useValue: mockCostTypeRepo },
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepo },
        { provide: getRepositoryToken(ProductModel), useValue: mockProductModelRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: DataSource, useValue: mockDataSource },
        { provide: RateService, useValue: mockRateService },
        { provide: CommissionService, useValue: mockCommissionService },
        { provide: SystemConfigService, useValue: mockSystemConfigService },
      ],
    }).compile()

    service = module.get<SalesOrderService>(SalesOrderService)
  })

  // ============================================================
  //  create（无预留模型：下单不校验/不占用库存）
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

    it('创建订单成功应返回订单（不触碰库存）', async () => {
      // upsertContact 查询联系人返回 null → 新建联系人
      mockManager.findOne.mockResolvedValue(null)

      const result = await service.create(validDto)

      expect(mockSequenceService.generate).toHaveBeenCalledWith('SO')
      expect(mockManager.save).toHaveBeenCalled()
      expect(result.orderNo).toBe('SO202601010001')
      // 无预留模型：创建订单不做任何库存查询/冻结
      expect(mockManager.createQueryBuilder).not.toHaveBeenCalled()
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

    it('客户名为空不应 upsert 联系人', async () => {
      const dto = { ...validDto, customerName: '' }

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
  //  update（无预留模型：修改明细不涉及库存操作）
  // ============================================================
  describe('update', () => {
    const existingOrder = {
      id: 'O001',
      orderNo: 'SO202601010001',
      customerName: '旧客户',
      shipmentStatus: 1,
      currency: 'USD',
      exchangeRate: '7.12',
      orderDate: '2026-01-01',
      receivedAmountUsd: '0',
      receivedAmountCny: '0',
      totalAmountUsd: '500',
      remark: '备注',
    }

    it('仅修改备注和客户名应成功', async () => {
      // manager.findOne 既用于查订单（SalesOrder），也用于 upsertContact 查联系人（CommonContact）
      mockManager.findOne.mockImplementation((entity: any) => {
        if (entity === CommonContact) return Promise.resolve(null)
        return Promise.resolve(existingOrder)
      })

      const result = await service.update('O001', {
        customerName: '新客户',
        remark: '新备注',
      })

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ customerName: '新客户', remark: '新备注' }),
      )
      expect(result.customerName).toBe('新客户')
    })

    it('整体替换明细应成功（不做库存解冻/冻结）', async () => {
      mockManager.findOne.mockResolvedValue(existingOrder)

      const result = await service.update('O001', {
        items: [{ productId: 'P002', quantity: '5', unitPrice: '100' }],
      })

      // 删除旧明细
      expect(mockItemRepo.delete).toHaveBeenCalledWith({ orderId: 'O001' })
      // 保存新明细
      expect(mockItemRepo.create).toHaveBeenCalled()
      expect(mockManager.save).toHaveBeenCalled()
      // 无预留模型：不做任何库存操作
      expect(mockManager.createQueryBuilder).not.toHaveBeenCalled()
      expect(result.totalAmountUsd).toBe('500.00')
    })

    it('订单不存在应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValue(null)

      await expect(service.update('O999', { customerName: '新客户' })).rejects.toThrow(BadRequestException)
    })

    it('订单已发货不应修改应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValue({ ...existingOrder, shipmentStatus: 2 })

      await expect(service.update('O001', { remark: '新备注' })).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  cancel（无预留模型：取消不触碰库存）
  // ============================================================
  describe('cancel', () => {
    it('待发货订单取消成功（不解冻库存）', async () => {
      mockManagerQB.getOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 1,
        remark: '普通订单',
        receivedAmountUsd: '0',
        receivedAmountCny: '0',
      })

      const result = await service.cancel('O001')

      expect(result.order.status).toBe(3)
      expect(result.needsRefund).toBe(false)
    })

    it('已完成订单无法取消应抛出 BadRequestException', async () => {
      mockManagerQB.getOne.mockResolvedValue({
        id: 'O001',
        status: 2,
        shipmentStatus: 3,
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })

    it('全部发货订单无法取消应抛出 BadRequestException', async () => {
      mockManagerQB.getOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 3,
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })

    it('部分发货订单无法取消应抛出 BadRequestException', async () => {
      mockManagerQB.getOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 2,
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })

    it('已取消订单不可重复取消应抛出 BadRequestException', async () => {
      mockManagerQB.getOne.mockResolvedValue({
        id: 'O001',
        status: 3,
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })

    it('已有收款的订单无法取消应抛出 BadRequestException', async () => {
      mockManagerQB.getOne.mockResolvedValue({
        id: 'O001',
        status: 1,
        shipmentStatus: 1,
        receivedAmountUsd: '500',
        receivedAmountCny: '3560',
      })

      await expect(service.cancel('O001')).rejects.toThrow(BadRequestException)
    })
  })

  // ============================================================
  //  updateReceivedAmount
  // ============================================================
  describe('updateReceivedAmount', () => {
    it('更新金额成功并重新计算状态', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        totalAmountUsd: '1000',
        receivedAmountUsd: '200',
        receivedAmountCny: '1424',
      })
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', shippedQuantity: '10' },
      ])

      await service.updateReceivedAmount('O001', '300', '2136')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          receivedAmountUsd: '500.00',
        }),
      )
    })

    it('订单不存在应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.updateReceivedAmount('O999', '100', '712')).rejects.toThrow(BadRequestException)
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
        totalAmountUsd: '1000',
        receivedAmountUsd: '1000',
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
        totalAmountUsd: '1000',
        receivedAmountUsd: '1000',
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
        totalAmountUsd: '1000',
        receivedAmountUsd: '0',
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
        totalAmountUsd: '1000',
        receivedAmountUsd: '500',
      })
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', shippedQuantity: '0' },
      ])

      await service.recalculateStatus('O001')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: 2 }),
      )
    })

    it('已取消订单不应重新计算', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'O001',
        status: 3,
        shipmentStatus: 1,
        paymentStatus: 1,
        totalAmountUsd: '1000',
        receivedAmountUsd: '0',
      })

      await service.recalculateStatus('O001')

      // status===3（已取消）时方法提前 return，不会查 items 也不会保存
      expect(mockItemRepo.find).not.toHaveBeenCalled()
      expect(mockOrderRepo.save).not.toHaveBeenCalled()
    })
  })
})
