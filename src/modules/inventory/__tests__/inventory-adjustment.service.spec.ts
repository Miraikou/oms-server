import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { BadRequestException } from '@nestjs/common'
import { InventoryAdjustmentService } from '../inventory-adjustment.service'
import { InventoryAdjustment } from '../entities/inventory-adjustment.entity'
import { InventoryAdjustmentItem } from '../entities/inventory-adjustment-item.entity'
import { Inventory } from '../entities/inventory.entity'
import { InventoryBatch } from '../entities/inventory-batch.entity'
import { InventoryFlow } from '../entities/inventory-flow.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { FifoService } from '../services/fifo.service'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

const mockFifoService = {
  consume: jest.fn().mockResolvedValue({
    items: [{ batchId: 'b1', quantity: 5, unitCostUsd: '50.00', totalCostUsd: '250.00', unitCostCny: '350.00', totalCostCny: '1750.00', currency: 'CNY', exchangeRate: '7.0000' }],
    totalCostUsd: '250.00',
    totalCostCny: '1750.00',
  }),
}

describe('InventoryAdjustmentService', () => {
  let service: InventoryAdjustmentService

  const mockAdjustmentRepo = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  const mockAdjustmentItemRepo = {
    find: jest.fn(),
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  const mockInventoryRepo = {
    findOne: jest.fn(),
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  const mockBatchRepo = {
    findOne: jest.fn(),
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  const mockFlowRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn((e: any) => Promise.resolve(e)),
  }

  const mockSequenceService = {
    generate: jest.fn(),
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryAdjustmentService,
        { provide: getRepositoryToken(InventoryAdjustment), useValue: mockAdjustmentRepo },
        { provide: getRepositoryToken(InventoryAdjustmentItem), useValue: mockAdjustmentItemRepo },
        { provide: getRepositoryToken(Inventory), useValue: mockInventoryRepo },
        { provide: getRepositoryToken(InventoryBatch), useValue: mockBatchRepo },
        { provide: getRepositoryToken(InventoryFlow), useValue: mockFlowRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: FifoService, useValue: mockFifoService },
      ],
    }).compile()

    service = module.get<InventoryAdjustmentService>(InventoryAdjustmentService)
  })

  // ═══════════════════════════════════════════════
  // create 测试
  // ═══════════════════════════════════════════════

  describe('create', () => {
    it('指定批次增加库存', async () => {
      const dto = {
        reason: '盘点',
        items: [{ productId: 'p1', batchId: 'b1', changeQuantity: '10' }],
      }

      const mockBatch = {
        id: 'b1',
        productId: 'p1',
        availableQuantity: '50.0000',
        stockQuantity: '50.0000',
        originalQuantity: '50.0000',
        unitCostUsd: '10.00',
        unitCostCny: '70.00',
        currency: 'CNY',
        exchangeRate: '7.0000',
        status: 1,
        version: 1,
      }

      const mockInventory = {
        id: 'inv-1',
        productId: 'p1',
        availableQuantity: '100.0000',
        frozenQuantity: '0.0000',
        stockQuantity: '100.0000',
        version: 1,
      }

      mockSequenceService.generate.mockResolvedValue('KC202607050001')
      mockBatchRepo.findOne.mockResolvedValue(mockBatch)
      mockInventoryRepo.findOne.mockResolvedValue(mockInventory)

      const result = await service.create(dto)

      // 验证调整单创建
      expect(mockAdjustmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '9999999999999999',
          adjustmentNo: 'KC202607050001',
          reason: '盘点',
        }),
      )
      expect(mockAdjustmentRepo.save).toHaveBeenCalled()

      // 验证调整明细创建
      expect(mockAdjustmentItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          adjustmentId: result.id,
          productId: 'p1',
          batchId: 'b1',
          changeQuantity: '10',
        }),
      )
      expect(mockAdjustmentItemRepo.save).toHaveBeenCalled()

      // 验证批次更新（available +10 → 60.0000）
      expect(mockBatchRepo.findOne).toHaveBeenCalledWith({ where: { id: 'b1' } })
      expect(mockBatchRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          availableQuantity: '60.0000',
          stockQuantity: '60.0000',
          originalQuantity: '60.0000',
          version: 2,
        }),
      )

      // 验证库存汇总更新
      expect(mockInventoryRepo.save).toHaveBeenCalled()
      // availableQuantity: 100 + 10 → parseFloat → toFixed(4) → '110.0000'
      const savedInv = mockInventoryRepo.save.mock.calls[0][0]
      expect(savedInv.availableQuantity).toBe('110.0000')
      expect(savedInv.stockQuantity).toBe('110.0000')

      // 验证流水写入
      expect(mockFlowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: 'b1',
          businessType: 5,
          businessId: result.id,
          changeType: 5,
          quantity: '10',
          unitCostUsd: '10.00',
          unitCostCny: '70.00',
          totalCostUsd: '100.00',
          totalCostCny: '700.00',
          beforeAvailable: '50.0000',
          afterAvailable: '60.0000',
        }),
      )
      expect(mockFlowRepo.save).toHaveBeenCalled()

      // FIFO 不应被调用
      expect(mockFifoService.consume).not.toHaveBeenCalled()
    })

    it('未指定批次增加库存（新建调整批次）', async () => {
      const dto = {
        reason: '盘盈',
        items: [{ productId: 'p1', changeQuantity: '20' }],
      }

      mockSequenceService.generate
        .mockResolvedValueOnce('KC202607050002')
        .mockResolvedValueOnce('BT202607050001')
      mockInventoryRepo.findOne.mockResolvedValue(null)

      const result = await service.create(dto)

      // 验证编号生成
      expect(mockSequenceService.generate).toHaveBeenNthCalledWith(1, 'KC')
      expect(mockSequenceService.generate).toHaveBeenNthCalledWith(2, 'BT')

      // 验证新建批次（batchSource=3 库存调整）
      expect(mockBatchRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          batchSource: 3,
          batchNo: 'BT202607050001',
          unitCostUsd: '0',
          unitCostCny: '0',
          originalQuantity: '20',
          availableQuantity: '20',
          stockQuantity: '20',
        }),
      )
      expect(mockBatchRepo.save).toHaveBeenCalled()

      // 验证库存汇总新建
      expect(mockInventoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'p1',
          availableQuantity: '20',
          stockQuantity: '20',
        }),
      )
      expect(mockInventoryRepo.save).toHaveBeenCalled()

      // 验证流水写入
      expect(mockFlowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unitCostUsd: '0',
          unitCostCny: '0',
          totalCostUsd: '0.00',
          totalCostCny: '0.00',
          beforeAvailable: '0',
          afterAvailable: '20',
          changeType: 5,
        }),
      )
      expect(mockFlowRepo.save).toHaveBeenCalled()

      // FIFO 不应被调用
      expect(mockFifoService.consume).not.toHaveBeenCalled()
    })

    it('减少库存（FIFO 消耗）', async () => {
      const dto = {
        reason: '盘亏',
        items: [{ productId: 'p1', batchId: 'b1', changeQuantity: '-5' }],
      }

      mockSequenceService.generate.mockResolvedValue('KC202607050003')

      const result = await service.create(dto)

      // 验证 FIFO 被调用
      expect(mockFifoService.consume).toHaveBeenCalledWith('p1', 5, result.id, 5)

      // 验证调整单创建
      expect(mockAdjustmentRepo.save).toHaveBeenCalled()
      // 验证调整明细创建
      expect(mockAdjustmentItemRepo.save).toHaveBeenCalled()

      // FIFO 走内部事务处理，以下方法不应被直接调用
      expect(mockBatchRepo.findOne).not.toHaveBeenCalled()
      expect(mockBatchRepo.save).not.toHaveBeenCalled()
      expect(mockInventoryRepo.findOne).not.toHaveBeenCalled()
      expect(mockInventoryRepo.save).not.toHaveBeenCalled()
      expect(mockFlowRepo.create).not.toHaveBeenCalled()
      expect(mockFlowRepo.save).not.toHaveBeenCalled()
    })

    it('调整明细为空时应抛出 BadRequestException', async () => {
      const dto = {
        reason: 'test',
        items: [] as any[],
      }

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)

      // 空明细不应触发任何后续操作
      expect(mockSequenceService.generate).not.toHaveBeenCalled()
      expect(mockAdjustmentRepo.save).not.toHaveBeenCalled()
    })

    it('调整数量为零时应抛出 BadRequestException', async () => {
      const dto = {
        reason: 'test',
        items: [{ productId: 'p1', batchId: 'b1', changeQuantity: '0' }],
      }

      mockSequenceService.generate.mockResolvedValue('KC202607050004')

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)

      // 调整单已创建，但明细在零校验前未被持久化
      expect(mockAdjustmentRepo.save).toHaveBeenCalled()
      expect(mockAdjustmentItemRepo.create).not.toHaveBeenCalled()
      expect(mockAdjustmentItemRepo.save).not.toHaveBeenCalled()
    })

    it('指定批次不存在时应抛出 BadRequestException', async () => {
      const dto = {
        reason: 'test',
        items: [{ productId: 'p1', batchId: 'nonexistent', changeQuantity: '10' }],
      }

      mockSequenceService.generate.mockResolvedValue('KC202607050005')
      mockBatchRepo.findOne.mockResolvedValue(null)

      await expect(service.create(dto)).rejects.toThrow(BadRequestException)

      // 调整单和明细已创建
      expect(mockAdjustmentRepo.save).toHaveBeenCalled()
      expect(mockAdjustmentItemRepo.save).toHaveBeenCalled()

      // 批次查询后未找到，不应继续
      expect(mockBatchRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'nonexistent' },
      })
      expect(mockBatchRepo.save).not.toHaveBeenCalled()
      expect(mockInventoryRepo.save).not.toHaveBeenCalled()
      expect(mockFlowRepo.save).not.toHaveBeenCalled()
      expect(mockFifoService.consume).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════
  // findAll 测试
  // ═══════════════════════════════════════════════

  describe('findAll', () => {
    it('分页查询调整单列表', async () => {
      const adjustmentList = [
        { id: 'adj-1', adjustmentNo: 'KC001', reason: '盘点1' },
        { id: 'adj-2', adjustmentNo: 'KC002', reason: '盘点2' },
      ]
      mockAdjustmentRepo.findAndCount.mockResolvedValue([adjustmentList, 2])

      const result = await service.findAll({ page: 1, pageSize: 10 } as any)

      expect(mockAdjustmentRepo.findAndCount).toHaveBeenCalledWith({
        order: { createdTime: 'DESC' },
        skip: 0,
        take: 10,
      })
      expect(result.list).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
    })

    it('默认分页参数', async () => {
      mockAdjustmentRepo.findAndCount.mockResolvedValue([[], 0])

      const result = await service.findAll({} as any)

      expect(mockAdjustmentRepo.findAndCount).toHaveBeenCalledWith({
        order: { createdTime: 'DESC' },
        skip: 0,
        take: 20,
      })
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })
  })

  // ═══════════════════════════════════════════════
  // findOne 测试
  // ═══════════════════════════════════════════════

  describe('findOne', () => {
    it('查询调整单详情（含明细）', async () => {
      const adjustment = {
        id: 'adj-1',
        adjustmentNo: 'KC001',
        reason: '盘点',
      }
      const items = [
        {
          id: 'item-1',
          adjustmentId: 'adj-1',
          productId: 'p1',
          changeQuantity: '10',
        },
        {
          id: 'item-2',
          adjustmentId: 'adj-1',
          productId: 'p2',
          changeQuantity: '-5',
        },
      ]

      mockAdjustmentRepo.findOne.mockResolvedValue(adjustment)
      mockAdjustmentItemRepo.find.mockResolvedValue(items)

      const result = await service.findOne('adj-1')

      expect(result.adjustmentNo).toBe('KC001')
      expect(result.reason).toBe('盘点')
      expect(result.items).toHaveLength(2)
      expect(result.items[0].productId).toBe('p1')
      expect(result.items[1].changeQuantity).toBe('-5')
    })

    it('调整单不存在时应抛出 BadRequestException', async () => {
      mockAdjustmentRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        BadRequestException,
      )

      expect(mockAdjustmentItemRepo.find).not.toHaveBeenCalled()
    })
  })
})
