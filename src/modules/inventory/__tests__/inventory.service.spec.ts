import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { InventoryService } from '../inventory.service'
import { Inventory } from '../entities/inventory.entity'
import { InventoryBatch } from '../entities/inventory-batch.entity'
import { InventoryFlow } from '../entities/inventory-flow.entity'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

describe('InventoryService', () => {
  let service: InventoryService

  const mockInventoryRepo = {
    findOne: jest.fn(),
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  const mockBatchRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  const mockFlowRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: getRepositoryToken(Inventory), useValue: mockInventoryRepo },
        { provide: getRepositoryToken(InventoryBatch), useValue: mockBatchRepo },
        { provide: getRepositoryToken(InventoryFlow), useValue: mockFlowRepo },
      ],
    }).compile()

    service = module.get<InventoryService>(InventoryService)
  })

  // ═══════════════════════════════════════════════
  // createBatch 测试
  // ═══════════════════════════════════════════════

  describe('createBatch', () => {
    it('成功创建批次（完整数据）', async () => {
      const inboundTime = new Date('2026-07-01')
      const data = {
        productId: '1001',
        receiptItemId: '2001',
        batchSource: 1,
        batchNo: 'BT001',
        unitCostUsd: '50.00',
        unitCostCny: '340.00',
        quantity: '100.0000',
        inboundTime,
        createdBy: '3001',
      }

      const result = await service.createBatch(data)

      expect(mockBatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '9999999999999999',
          productId: '1001',
          receiptItemId: '2001',
          batchSource: 1,
          batchNo: 'BT001',
          unitCostUsd: '50.00',
          unitCostCny: '340.00',
          originalQuantity: '100.0000',
          availableQuantity: '100.0000',
          frozenQuantity: '0',
          stockQuantity: '100.0000',
          inboundTime,
          freezeStatus: 1,
          status: 1,
          createdBy: '3001',
        }),
      )
      expect(mockBatchRepo.save).toHaveBeenCalled()
      expect(result.id).toBe('9999999999999999')
    })

    it('成功创建批次（可选字段为 null）', async () => {
      const data = {
        productId: '1002',
        receiptItemId: null,
        batchSource: 3,
        batchNo: 'BT002',
        unitCostUsd: '0',
        unitCostCny: '0',
        quantity: '20.0000',
        inboundTime: new Date('2026-07-05'),
      }

      const result = await service.createBatch(data)

      expect(mockBatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          receiptItemId: null,
          createdBy: null,
        }),
      )
      expect(mockBatchRepo.save).toHaveBeenCalled()
      expect(result).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════
  // updateInventorySummary 测试
  // ═══════════════════════════════════════════════

  describe('updateInventorySummary', () => {
    it('库存已存在时更新汇总', async () => {
      const existingInv: Record<string, any> = {
        id: 'inv-1',
        productId: 'p1',
        availableQuantity: '100.0000',
        frozenQuantity: '0.0000',
        stockQuantity: '100.0000',
        minimumStock: '0',
        version: 0,
      }
      mockInventoryRepo.findOne.mockResolvedValue(existingInv)

      const result = await service.updateInventorySummary('p1', null, 20, 'user1')

      expect(mockInventoryRepo.findOne).toHaveBeenCalledWith({
        where: { productId: 'p1' },
      })
      expect(mockInventoryRepo.create).not.toHaveBeenCalled()
      expect(existingInv.availableQuantity).toBe('120')
      expect(existingInv.stockQuantity).toBe('120')
      expect(existingInv.version).toBe(1)
      expect(existingInv.updatedBy).toBe('user1')
      expect(mockInventoryRepo.save).toHaveBeenCalledWith(existingInv)
    })

    it('库存不存在时创建新汇总', async () => {
      mockInventoryRepo.findOne.mockResolvedValue(null)

      const result = await service.updateInventorySummary('p2', null, 50)

      expect(mockInventoryRepo.findOne).toHaveBeenCalledWith({
        where: { productId: 'p2' },
      })
      expect(mockInventoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '9999999999999999',
          productId: 'p2',
          availableQuantity: '50',
          stockQuantity: '50',
          frozenQuantity: '0',
          minimumStock: '0',
          version: 0,
        }),
      )
      expect(mockInventoryRepo.save).toHaveBeenCalled()
    })

    it('正向增量时数量增加', async () => {
      const existingInv = {
        id: 'inv-1',
        productId: 'p1',
        availableQuantity: '100.0000',
        frozenQuantity: '0.0000',
        stockQuantity: '100.0000',
        minimumStock: '0',
        version: 0,
      }
      mockInventoryRepo.findOne.mockResolvedValue(existingInv)

      await service.updateInventorySummary('p1', null, 30.5)

      expect(existingInv.availableQuantity).toBe('130.5')
      expect(existingInv.stockQuantity).toBe('130.5')
    })

    it('负向增量时数量减少', async () => {
      const existingInv = {
        id: 'inv-1',
        productId: 'p1',
        availableQuantity: '100.0000',
        frozenQuantity: '0.0000',
        stockQuantity: '100.0000',
        minimumStock: '0',
        version: 0,
      }
      mockInventoryRepo.findOne.mockResolvedValue(existingInv)

      await service.updateInventorySummary('p1', null, -25)

      expect(existingInv.availableQuantity).toBe('75')
      expect(existingInv.stockQuantity).toBe('75')
    })
  })

  // ═══════════════════════════════════════════════
  // writeFlow 测试
  // ═══════════════════════════════════════════════

  describe('writeFlow', () => {
    it('成功写入流水（完整数据）', async () => {
      const data = {
        batchId: 'b1',
        productId: 'p1',
        businessType: 1,
        businessId: 'biz-1',
        changeType: 1,
        quantity: '100.0000',
        unitCostUsd: '50.00',
        totalCostUsd: '5000.00',
        beforeAvailable: '0',
        afterAvailable: '100.0000',
        beforeFrozen: '0',
        afterFrozen: '0',
        createdBy: 'user1',
        remark: '采购入库',
      }

      const result = await service.writeFlow(data)

      expect(mockFlowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: '9999999999999999', ...data }),
      )
      expect(mockFlowRepo.save).toHaveBeenCalled()
      expect(result.id).toBe('9999999999999999')
    })

    it('成功写入流水（不含可选字段）', async () => {
      const data = {
        batchId: 'b2',
        productId: 'p2',
        businessType: 2,
        businessId: 'biz-2',
        changeType: 2,
        quantity: '50.0000',
        beforeAvailable: '100.0000',
        afterAvailable: '50.0000',
        beforeFrozen: '0',
        afterFrozen: '0',
      }

      const result = await service.writeFlow(data)

      expect(mockFlowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: '9999999999999999', ...data }),
      )
      expect(mockFlowRepo.save).toHaveBeenCalled()
      expect(result).toBeDefined()
    })
  })
})
