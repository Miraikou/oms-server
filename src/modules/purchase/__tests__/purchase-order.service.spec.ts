import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { BadRequestException } from '@nestjs/common'
import { PurchaseOrderService } from '../purchase-order.service'
import { PurchaseOrder } from '../entities/purchase-order.entity'
import { PurchaseOrderItem } from '../entities/purchase-order-item.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { snowflake } from '@/common/utils/snowflake'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

// ---- Mock Repositories ----
const mockOrderRepo = {
  findOne: jest.fn(),
  create: jest.fn((data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  createQueryBuilder: jest.fn(),
}

const mockItemRepo = {
  find: jest.fn(),
  create: jest.fn((data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  delete: jest.fn(),
}

// ---- Mock QueryBuilder ----
const mockQB = {
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
}

const mockSequenceService = {
  generate: jest.fn().mockResolvedValue('CG202601010001'),
}

describe('PurchaseOrderService', () => {
  let service: PurchaseOrderService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrderService,
        { provide: getRepositoryToken(PurchaseOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(PurchaseOrderItem), useValue: mockItemRepo },
        { provide: SequenceService, useValue: mockSequenceService },
      ],
    }).compile()

    service = module.get<PurchaseOrderService>(PurchaseOrderService)
  })

  // ============================================================
  //  create
  // ============================================================
  describe('create', () => {
    const validDto = {
      supplierId: 'S001',
      purchaseDate: '2026-01-01',
      currency: 'CNY',
      exchangeRate: '1.000000',
      remark: '正常采购',
      items: [
        { productId: 'P001', quantity: '10', unitPrice: '50' },
        { productId: 'P002', quantity: '5', unitPrice: '100' },
      ],
    }

    it('成功创建采购单并计算总金额', async () => {
      const result = await service.create(validDto)

      expect(mockSequenceService.generate).toHaveBeenCalledWith('CG')
      expect(snowflake.nextId).toHaveBeenCalled()
      // 10*50 + 5*100 = 1000
      expect(result.totalAmount).toBe('1000.00')
      expect(result.supplierId).toBe('S001')
      expect(result.currency).toBe('CNY')
    })

    it('采购明细为空应抛出 BadRequestException', async () => {
      const dto = { ...validDto, items: [] }

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)
      expect(mockOrderRepo.save).not.toHaveBeenCalled()
    })

    it('采购数量小于等于0应抛出 BadRequestException', async () => {
      const dto = {
        ...validDto,
        items: [{ productId: 'P001', quantity: '0', unitPrice: '50' }],
      }

      await expect(service.create(dto)).rejects.toThrow('采购数量必须大于零')
    })

    it('采购单价小于等于0应抛出 BadRequestException', async () => {
      const dto = {
        ...validDto,
        items: [{ productId: 'P001', quantity: '10', unitPrice: '0' }],
      }

      await expect(service.create(dto)).rejects.toThrow('采购单价必须大于零')
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
      const mockList = [{ id: 'PO001', purchaseNo: 'CG202601010001' }]
      mockQB.getManyAndCount.mockResolvedValue([mockList, 1])

      const result = await service.findAll({
        purchaseNo: 'CG2026',
        supplierId: 'S001',
        status: 1,
        page: 1,
        pageSize: 10,
      } as any)

      expect(mockQB.andWhere).toHaveBeenCalledTimes(3)
      expect(result.list).toEqual(mockList)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
    })

    it('默认分页参数应正常工作', async () => {
      mockQB.getManyAndCount.mockResolvedValue([[], 0])

      const result = await service.findAll({} as any)

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
    it('存在应返回采购单及明细', async () => {
      const mockOrder = {
        id: 'PO001',
        purchaseNo: 'CG202601010001',
        supplierId: 'S001',
        status: 1,
      }
      const mockItems = [
        { id: 'POI001', purchaseOrderId: 'PO001', productId: 'P001' },
      ]
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockItemRepo.find.mockResolvedValue(mockItems)

      const result = await service.findOne('PO001')

      expect(result).toEqual({ ...mockOrder, items: mockItems })
    })

    it('不存在应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('PO999')).rejects.toThrow('采购单不存在')
    })
  })

  // ============================================================
  //  update
  // ============================================================
  describe('update', () => {
    const existingOrder = {
      id: 'PO001',
      purchaseNo: 'CG202601010001',
      supplierId: 'S001',
      status: 1,
      totalAmount: '500.00',
      remark: '旧备注',
    }

    it('仅修改备注应成功', async () => {
      mockOrderRepo.findOne.mockResolvedValue(existingOrder)
      // findOne 内部会查询明细
      mockItemRepo.find.mockResolvedValue([])

      const result = await service.update('PO001', { remark: '新备注' })

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ remark: '新备注' }),
      )
      expect(mockItemRepo.delete).not.toHaveBeenCalled()
      expect(result.remark).toBe('新备注')
    })

    it('整体替换明细应成功并重新计算金额', async () => {
      mockOrderRepo.findOne.mockResolvedValue(existingOrder)
      mockItemRepo.find.mockResolvedValue([
        { id: 'POI001', productId: 'P001', quantity: '10' },
      ])

      const result = await service.update('PO001', {
        items: [{ productId: 'P003', quantity: '3', unitPrice: '200' }],
      })

      expect(mockItemRepo.delete).toHaveBeenCalledWith({
        purchaseOrderId: 'PO001',
      })
      // 3 * 200 = 600
      expect(result.totalAmount).toBe('600.00')
    })

    it('非待入库状态无法修改应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        ...existingOrder,
        status: 3,
      })
      mockItemRepo.find.mockResolvedValue([])

      await expect(
        service.update('PO001', { remark: '新备注' }),
      ).rejects.toThrow('仅待入库状态的采购单可以修改')
    })
  })

  // ============================================================
  //  close
  // ============================================================
  describe('close', () => {
    it('关闭待入库采购单应成功', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'PO001',
        status: 1,
      })

      const result = await service.close('PO001')

      expect(result.status).toBe(4)
      expect(mockOrderRepo.save).toHaveBeenCalled()
    })

    it('已全部入库无法关闭应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'PO001',
        status: 3,
      })

      await expect(service.close('PO001')).rejects.toThrow('已全部入库')
    })

    it('已关闭无法重复关闭应抛出 BadRequestException', async () => {
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'PO001',
        status: 4,
      })

      await expect(service.close('PO001')).rejects.toThrow('采购单已关闭')
    })
  })

  // ============================================================
  //  recalculateStatus
  // ============================================================
  describe('recalculateStatus', () => {
    it('全部入库应更新状态为3', async () => {
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', receivedQuantity: '10' },
      ])
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'PO001',
        status: 2,
      })

      await service.recalculateStatus('PO001')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 3 }),
      )
    })

    it('部分入库应更新状态为2', async () => {
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', receivedQuantity: '5' },
      ])
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'PO001',
        status: 1,
      })

      await service.recalculateStatus('PO001')

      expect(mockOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 2 }),
      )
    })

    it('已关闭状态不重新计算', async () => {
      mockItemRepo.find.mockResolvedValue([
        { quantity: '10', receivedQuantity: '10' },
      ])
      mockOrderRepo.findOne.mockResolvedValue({
        id: 'PO001',
        status: 4,
      })

      await service.recalculateStatus('PO001')

      expect(mockOrderRepo.save).not.toHaveBeenCalled()
    })
  })
})
