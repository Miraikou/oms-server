import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { BadRequestException } from '@nestjs/common'
import { PurchaseReceiptService } from '../purchase-receipt.service'
import { PurchaseReceipt } from '../entities/purchase-receipt.entity'
import { PurchaseReceiptItem } from '../entities/purchase-receipt-item.entity'
import { PurchaseOrder } from '../entities/purchase-order.entity'
import { PurchaseOrderItem } from '../entities/purchase-order-item.entity'
import { Inventory } from '@/modules/inventory/entities/inventory.entity'
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity'
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { snowflake } from '@/common/utils/snowflake'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

// ---- Mock Repositories ----
const mockReceiptRepo = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
}
const mockReceiptItemRepo = {
  find: jest.fn(),
}
const mockOrderRepo = {}
const mockOrderItemRepo = {}
const mockInventoryRepo = {}
const mockBatchRepo = {}
const mockFlowRepo = {}

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
  create: jest.fn((_entity: any, data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
}

const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
}

const mockSequenceService = {
  generate: jest.fn().mockResolvedValue('RK202601010001'),
}

describe('PurchaseReceiptService', () => {
  let service: PurchaseReceiptService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseReceiptService,
        { provide: getRepositoryToken(PurchaseReceipt), useValue: mockReceiptRepo },
        { provide: getRepositoryToken(PurchaseReceiptItem), useValue: mockReceiptItemRepo },
        { provide: getRepositoryToken(PurchaseOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(PurchaseOrderItem), useValue: mockOrderItemRepo },
        { provide: getRepositoryToken(Inventory), useValue: mockInventoryRepo },
        { provide: getRepositoryToken(InventoryBatch), useValue: mockBatchRepo },
        { provide: getRepositoryToken(InventoryFlow), useValue: mockFlowRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<PurchaseReceiptService>(PurchaseReceiptService)
  })

  // ============================================================
  //  createReceipt
  // ============================================================
  describe('createReceipt', () => {
    const mockOrder = {
      id: 'PO001',
      purchaseNo: 'CG202601010001',
      status: 1,
      supplierId: 'S001',
    }

    const mockOrderItems = [
      {
        id: 'POI001',
        purchaseOrderId: 'PO001',
        productId: 'P001',
        quantity: '10',
        unitPrice: '50.00',
        amount: '500.00',
        receivedQuantity: '0',
        returnedQuantity: '0',
      },
    ]

    const mockUpdatedOrderItems = [
      {
        id: 'POI001',
        purchaseOrderId: 'PO001',
        productId: 'P001',
        quantity: '10',
        unitPrice: '50.00',
        amount: '500.00',
        receivedQuantity: '5.0000',
        returnedQuantity: '0',
      },
    ]

    const validDto = {
      purchaseOrderId: 'PO001',
      receiptDate: '2026-01-15',
      remark: '正常入库',
      items: [{ purchaseOrderItemId: 'POI001', quantity: '5' }],
    }

    it('成功创建入库单 - 全新商品无库存记录', async () => {
      // Step 1: 查询采购单
      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)
        // Step 5: 查询库存（不存在）
        .mockResolvedValueOnce(null)
      // Step 1: 查询采购明细 / Step 7: 重新计算状态
      mockManager.find
        .mockResolvedValueOnce(mockOrderItems)
        .mockResolvedValueOnce(mockUpdatedOrderItems)

      const result = await service.createReceipt(validDto)

      expect(mockSequenceService.generate).toHaveBeenCalledWith('RK')
      expect(mockDataSource.transaction).toHaveBeenCalled()
      expect(result.receiptNo).toBe('RK202601010001')
      expect(result.purchaseOrderId).toBe('PO001')
      expect(result.remark).toBe('正常入库')
    })

    it('成功创建入库单 - 已有库存商品', async () => {
      const existingInventory = {
        id: 'INV001',
        productId: 'P001',
        availableQuantity: '100',
        frozenQuantity: '0',
        stockQuantity: '100',
        minimumStock: '0',
        version: 0,
      }

      mockManager.findOne
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(existingInventory)
      mockManager.find
        .mockResolvedValueOnce(mockOrderItems)
        .mockResolvedValueOnce(mockUpdatedOrderItems)

      const result = await service.createReceipt(validDto)

      expect(result.receiptNo).toBe('RK202601010001')
      // 验证库存版本号已递增（version: 0 → version: 1）
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ version: 1 }),
      )
    })

    it('入库明细为空应抛出 BadRequestException', async () => {
      const dto = { ...validDto, items: [] }

      await expect(service.createReceipt(dto)).rejects.toThrow(BadRequestException)
      // 空明细应在事务外校验
      expect(mockDataSource.transaction).not.toHaveBeenCalled()
    })

    it('采购单不存在应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce(null)

      await expect(service.createReceipt(validDto)).rejects.toThrow(
        '采购单不存在',
      )
    })

    it('采购单已全部入库应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce({ ...mockOrder, status: 3 })

      await expect(service.createReceipt(validDto)).rejects.toThrow(
        '采购单已全部入库',
      )
    })

    it('采购单已关闭应抛出 BadRequestException', async () => {
      mockManager.findOne.mockResolvedValueOnce({ ...mockOrder, status: 4 })

      await expect(service.createReceipt(validDto)).rejects.toThrow(
        '采购单已关闭',
      )
    })

    it('入库数量超过可入库数量应抛出 BadRequestException', async () => {
      const partiallyReceived = [
        { ...mockOrderItems[0], receivedQuantity: '8' },
      ]

      mockManager.findOne.mockResolvedValueOnce(mockOrder)
      mockManager.find.mockResolvedValueOnce(partiallyReceived)
      // 5 > 10 - 8 = 2，应抛出异常
      await expect(service.createReceipt(validDto)).rejects.toThrow(
        '超过可入库数量',
      )
    })
  })

  // ============================================================
  //  findOne
  // ============================================================
  describe('findOne', () => {
    it('存在应返回入库单及明细', async () => {
      const mockReceipt = {
        id: 'R001',
        receiptNo: 'CG202601010001',
        purchaseOrderId: 'PO001',
      }
      const mockItems = [
        { id: 'RI001', receiptId: 'R001', productId: 'P001' },
      ]
      mockReceiptRepo.findOne.mockResolvedValue(mockReceipt)
      mockReceiptItemRepo.find.mockResolvedValue(mockItems)

      const result = await service.findOne('R001')

      expect(result).toEqual({ ...mockReceipt, items: mockItems })
    })

    it('不存在应抛出 BadRequestException', async () => {
      mockReceiptRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('R999')).rejects.toThrow('入库单不存在')
    })
  })

  // ============================================================
  //  findAll
  // ============================================================
  describe('findAll', () => {
    beforeEach(() => {
      mockReceiptRepo.createQueryBuilder.mockReturnValue(mockQB)
    })

    it('分页查询并支持采购单ID过滤', async () => {
      const mockList = [{ id: 'R001', receiptNo: 'CG202601010001' }]
      mockQB.getManyAndCount.mockResolvedValue([mockList, 1])

      const result = await service.findAll({
        purchaseOrderId: 'PO001',
        page: 1,
        pageSize: 10,
      } as any)

      expect(mockReceiptRepo.createQueryBuilder).toHaveBeenCalledWith('pr')
      expect(mockQB.andWhere).toHaveBeenCalledWith(
        'pr.purchaseOrderId = :purchaseOrderId',
        { purchaseOrderId: 'PO001' },
      )
      expect(mockQB.skip).toHaveBeenCalledWith(0)
      expect(mockQB.take).toHaveBeenCalledWith(10)
      expect(result.list).toEqual(mockList)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
    })
  })
})
