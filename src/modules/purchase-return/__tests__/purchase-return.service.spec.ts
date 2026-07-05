import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { PurchaseReturnService } from '../purchase-return.service'
import { PurchaseReturn } from '../entities/purchase-return.entity'
import { PurchaseReturnItem } from '../entities/purchase-return-item.entity'
import { PurchaseOrder } from '@/modules/purchase/entities/purchase-order.entity'
import { PurchaseOrderItem } from '@/modules/purchase/entities/purchase-order-item.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { FifoService } from '@/modules/inventory/services/fifo.service'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

// ---- Mock Repositories ----
const mockReturnRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockReturnItemRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
}

const mockOrderRepo = {
  findOne: jest.fn(),
}

const mockOrderItemRepo = {
  findOne: jest.fn(),
}

// ---- Mock QueryBuilder (for findAll) ----
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
  create: jest.fn((_entity: any, data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
}

const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
}

// ---- Mock Services ----
const mockSequenceService = {
  generate: jest.fn().mockResolvedValue('PT202601010001'),
}

const mockFifoService = {
  consume: jest.fn().mockResolvedValue(undefined),
}

// ---- Test Data ----
const mockOrder = {
  id: 'po-1',
  purchaseNo: 'PO202601010001',
  status: 2,
}

const mockOrderItem = {
  id: 'poi-1',
  productId: 'prod-1',
  quantity: '10',
  unitPrice: '100.00',
  amount: '1000.00',
  receivedQuantity: '10',
  returnedQuantity: '2',
}

const createDto = {
  purchaseOrderId: 'po-1',
  returnDate: '2026-01-15',
  deductInventory: 1,
  items: [{ purchaseOrderItemId: 'poi-1', quantity: '3' }],
}

describe('PurchaseReturnService', () => {
  let service: PurchaseReturnService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockReturnRepo.createQueryBuilder.mockReturnValue(mockQB)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseReturnService,
        { provide: getRepositoryToken(PurchaseReturn), useValue: mockReturnRepo },
        { provide: getRepositoryToken(PurchaseReturnItem), useValue: mockReturnItemRepo },
        { provide: getRepositoryToken(PurchaseOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(PurchaseOrderItem), useValue: mockOrderItemRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: FifoService, useValue: mockFifoService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<PurchaseReturnService>(PurchaseReturnService)
  })

  // ============================================================
  //  create
  // ============================================================
  describe('create', () => {
    it('应成功创建退货单并扣减库存 (deductInventory=1)', async () => {
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)          // PurchaseOrder
        .mockResolvedValueOnce(mockOrderItem)       // PurchaseOrderItem（校验）
        .mockResolvedValueOnce(mockOrderItem)       // PurchaseOrderItem（查询 productId）

      const result = await service.create(createDto)

      expect(mockDataSource.transaction).toHaveBeenCalled()
      expect(mockSequenceService.generate).toHaveBeenCalledWith('PT')
      expect(result.returnNo).toBe('PT202601010001')
      expect(result.purchaseOrderId).toBe('po-1')
      // 应调用 FIFO 扣减库存
      expect(mockFifoService.consume).toHaveBeenCalledWith(
        'prod-1',
        3,
        '9999999999999999',
        4,
      )
      // 应更新采购明细的退货数量
      expect(mockManager.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ returnedQuantity: '5.0000' }),
      )
    })

    it('应成功创建退货单但不扣减库存 (deductInventory=0)', async () => {
      const dtoWithoutDeduct = { ...createDto, deductInventory: 0 }

      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)          // PurchaseOrder
        .mockResolvedValueOnce(mockOrderItem)       // PurchaseOrderItem（校验）
        .mockResolvedValueOnce(mockOrderItem)       // PurchaseOrderItem（查询 productId）

      await service.create(dtoWithoutDeduct)

      expect(mockFifoService.consume).not.toHaveBeenCalled()
    })

    it('退货明细为空时应抛出 BadRequestException', async () => {
      const dtoWithEmptyItems = {
        ...createDto,
        items: [],
      }

      await expect(service.create(dtoWithEmptyItems)).rejects.toThrow(
        BadRequestException,
      )
      // 不应进入事务
      expect(mockDataSource.transaction).not.toHaveBeenCalled()
    })

    it('采购单不存在时应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce(null) // PurchaseOrder 返回 null

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException)
      expect(mockDataSource.transaction).toHaveBeenCalled()
    })

    it('采购单状态小于 2（未入库）时应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce({
        id: 'po-1',
        status: 1,
      }) // PurchaseOrder 状态为 1

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException)
    })

    it('退货数量超过可退数量时应抛出 BadRequestException', async () => {
      const lowReturnableItem = {
        ...mockOrderItem,
        receivedQuantity: '5',
        returnedQuantity: '4.5', // returnable = 0.5
      }

      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)        // PurchaseOrder
        .mockResolvedValueOnce(lowReturnableItem) // PurchaseOrderItem（校验）

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // ============================================================
  //  findOne
  // ============================================================
  describe('findOne', () => {
    it('应返回退货单详情（含明细）', async () => {
      const mockReturn = {
        id: '9999999999999999',
        returnNo: 'PT202601010001',
        purchaseOrderId: 'po-1',
        returnDate: new Date('2026-01-15'),
        deductInventory: 1,
      }
      const mockItems = [
        {
          id: '9999999999999999',
          purchaseReturnId: '9999999999999999',
          purchaseOrderItemId: 'poi-1',
          productId: 'prod-1',
          quantity: '3',
          deductInventory: 1,
        },
      ]

      mockReturnRepo.findOne.mockResolvedValue(mockReturn)
      mockReturnItemRepo.find.mockResolvedValue(mockItems)

      const result = await service.findOne('9999999999999999')

      expect(result.returnNo).toBe('PT202601010001')
      expect(result.items).toEqual(mockItems)
      expect(mockReturnRepo.findOne).toHaveBeenCalledWith({
        where: { id: '9999999999999999' },
      })
      expect(mockReturnItemRepo.find).toHaveBeenCalledWith({
        where: { purchaseReturnId: '9999999999999999' },
      })
    })

    it('退货单不存在时应抛出 BadRequestException', async () => {
      mockReturnRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('not-exist')).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // ============================================================
  //  findAll
  // ============================================================
  describe('findAll', () => {
    it('应返回分页数据', async () => {
      const mockList = [
        {
          id: '9999999999999999',
          returnNo: 'PT202601010001',
          purchaseOrderId: 'po-1',
          returnDate: new Date('2026-01-15'),
          deductInventory: 1,
        },
      ]
      mockQB.getManyAndCount.mockResolvedValue([mockList, 1])

      const result = await service.findAll({
        returnNo: 'PT202601010001',
        page: 1,
        pageSize: 20,
      } as any)

      expect(result.list).toEqual(mockList)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      // 应包含查询条件
      expect(mockQB.andWhere).toHaveBeenCalledWith('r.returnNo LIKE :no', {
        no: '%PT202601010001%',
      })
    })

    it('无查询条件时应使用默认分页', async () => {
      mockQB.getManyAndCount.mockResolvedValue([[], 0])

      const result = await service.findAll({} as any)

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(result.total).toBe(0)
    })
  })
})
