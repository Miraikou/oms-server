import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FifoService } from '../fifo.service';
import { InventoryBatch } from '../../entities/inventory-batch.entity';
import { Inventory } from '../../entities/inventory.entity';
import { InventoryFlow } from '../../entities/inventory-flow.entity';

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}));

/** 创建 mock QueryBuilder（链式调用） */
function createMockQB() {
  const qb: any = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
  };
  return qb;
}

/** 创建测试批次 */
function makeBatch(overrides: Partial<any> = {}) {
  return {
    id: 'batch-1',
    batchNo: 'BT001',
    productId: 'prod-1',
    unitCost: '50.00',
    availableQuantity: '100.0000',
    frozenQuantity: '0.0000',
    stockQuantity: '100.0000',
    inboundTime: new Date('2026-01-01'),
    status: 1,
    freezeStatus: 0,
    version: 1,
    ...overrides,
  };
}

/** 创建测试库存汇总 */
function makeInventory(overrides: Partial<any> = {}) {
  return {
    id: 'inv-1',
    productId: 'prod-1',
    availableQuantity: '100.0000',
    frozenQuantity: '0.0000',
    stockQuantity: '100.0000',
    version: 1,
    ...overrides,
  };
}

describe('FifoService', () => {
  let service: FifoService;
  let mockQB: ReturnType<typeof createMockQB>;
  let savedEntities: any[];

  const mockManager = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb: Function) => cb(mockManager)),
  };

  beforeEach(async () => {
    mockQB = createMockQB();
    savedEntities = [];

    mockManager.createQueryBuilder.mockReturnValue(mockQB);
    mockManager.save.mockImplementation((entity: any) => {
      savedEntities.push({ ...entity });
      return Promise.resolve(entity);
    });
    mockManager.create.mockImplementation((_: any, data: any) => ({
      id: '9999999999999999',
      ...data,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FifoService,
        { provide: getRepositoryToken(InventoryBatch), useValue: {} },
        { provide: getRepositoryToken(Inventory), useValue: {} },
        { provide: getRepositoryToken(InventoryFlow), useValue: {} },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<FifoService>(FifoService);
  });

  // ═══════════════════════════════════════════════
  // consume 测试
  // ═══════════════════════════════════════════════

  describe('consume', () => {
    it('应从单个批次完全扣减', async () => {
      const batch = makeBatch({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });
      const inventory = makeInventory({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });

      mockQB.getMany.mockResolvedValue([batch]);
      mockManager.findOne.mockResolvedValue(inventory);

      const result = await service.consume('prod-1', null, 50, 'biz-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(50);
      expect(result.items[0].unitCost).toBe('50.00');
      expect(result.items[0].totalCost).toBe('2500.00');
      expect(result.totalCost).toBe('2500.00');
    });

    it('应跨批次扣减（FIFO 顺序）', async () => {
      const batch1 = makeBatch({
        id: 'batch-1',
        batchNo: 'BT001',
        availableQuantity: '30.0000',
        stockQuantity: '30.0000',
        unitCost: '40.00',
        inboundTime: new Date('2026-01-01'),
      });
      const batch2 = makeBatch({
        id: 'batch-2',
        batchNo: 'BT002',
        availableQuantity: '70.0000',
        stockQuantity: '70.0000',
        unitCost: '60.00',
        inboundTime: new Date('2026-02-01'),
      });
      const inventory = makeInventory({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });

      mockQB.getMany.mockResolvedValue([batch1, batch2]);
      mockManager.findOne.mockResolvedValue(inventory);

      const result = await service.consume('prod-1', null, 50, 'biz-1');

      expect(result.items).toHaveLength(2);
      // 第一批扣 30
      expect(result.items[0].batchId).toBe('batch-1');
      expect(result.items[0].quantity).toBe(30);
      expect(result.items[0].totalCost).toBe('1200.00'); // 30 * 40
      // 第二批扣 20
      expect(result.items[1].batchId).toBe('batch-2');
      expect(result.items[1].quantity).toBe(20);
      expect(result.items[1].totalCost).toBe('1200.00'); // 20 * 60
      // 总成本 = 1200 + 1200 = 2400
      expect(result.totalCost).toBe('2400.00');
    });

    it('库存不足时应抛出 BadRequestException', async () => {
      const batch = makeBatch({ availableQuantity: '10.0000' });
      mockQB.getMany.mockResolvedValue([batch]);

      await expect(service.consume('prod-1', null, 50, 'biz-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('扣减数量 <= 0 时应抛出 BadRequestException', async () => {
      await expect(service.consume('prod-1', null, 0, 'biz-1')).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.consume('prod-1', null, -5, 'biz-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('应正确更新库存汇总的 available 和 stock', async () => {
      const batch = makeBatch({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });
      const inventory = makeInventory({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });

      mockQB.getMany.mockResolvedValue([batch]);
      mockManager.findOne.mockResolvedValue(inventory);

      await service.consume('prod-1', null, 30, 'biz-1');

      // 找到库存汇总的 save（id = 'inv-1'）
      const inventorySave = savedEntities.find((e) => e.id === 'inv-1');
      expect(inventorySave.availableQuantity).toBe('70.0000');
      expect(inventorySave.stockQuantity).toBe('70.0000');
    });

    it('批次完全扣减后应标记 status=2（耗尽）', async () => {
      const batch = makeBatch({
        availableQuantity: '50.0000',
        stockQuantity: '50.0000',
        frozenQuantity: '0.0000',
      });
      const inventory = makeInventory({
        availableQuantity: '50.0000',
        stockQuantity: '50.0000',
      });

      mockQB.getMany.mockResolvedValue([batch]);
      mockManager.findOne.mockResolvedValue(inventory);

      await service.consume('prod-1', null, 50, 'biz-1');

      // batch save 应在 inventory save 之前
      const batchSave = savedEntities.find((e) => e.id === 'batch-1');
      expect(batchSave.status).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════
  // freeze 测试
  // ═══════════════════════════════════════════════

  describe('freeze', () => {
    it('应正确冻结库存（available → frozen）', async () => {
      const batch = makeBatch({
        availableQuantity: '100.0000',
        frozenQuantity: '0.0000',
      });
      const inventory = makeInventory({
        availableQuantity: '100.0000',
        frozenQuantity: '0.0000',
      });

      mockQB.getMany.mockResolvedValue([batch]);
      mockManager.findOne.mockResolvedValue(inventory);

      const result = await service.freeze('prod-1', null, 30, 'order-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(30);

      // 验证批次 available 减少，frozen 增加
      const batchSave = savedEntities.find((e) => e.id === 'batch-1');
      expect(batchSave.availableQuantity).toBe('70.0000');
      expect(batchSave.frozenQuantity).toBe('30.0000');
    });

    it('可销售库存不足时应拒绝冻结', async () => {
      const batch = makeBatch({ availableQuantity: '10.0000' });
      mockQB.getMany.mockResolvedValue([batch]);

      await expect(service.freeze('prod-1', null, 50, 'order-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('冻结数量 <= 0 时应抛出异常', async () => {
      await expect(service.freeze('prod-1', null, 0, 'order-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('跨批次冻结应按 FIFO 顺序', async () => {
      const batch1 = makeBatch({
        id: 'b1',
        availableQuantity: '20.0000',
        frozenQuantity: '0.0000',
        inboundTime: new Date('2026-01-01'),
      });
      const batch2 = makeBatch({
        id: 'b2',
        availableQuantity: '80.0000',
        frozenQuantity: '0.0000',
        inboundTime: new Date('2026-02-01'),
      });
      const inventory = makeInventory({
        availableQuantity: '100.0000',
        frozenQuantity: '0.0000',
      });

      mockQB.getMany.mockResolvedValue([batch1, batch2]);
      mockManager.findOne.mockResolvedValue(inventory);

      const result = await service.freeze('prod-1', null, 50, 'order-1');

      expect(result.items).toHaveLength(2);
      expect(result.items[0].batchId).toBe('b1');
      expect(result.items[0].quantity).toBe(20);
      expect(result.items[1].batchId).toBe('b2');
      expect(result.items[1].quantity).toBe(30);
    });
  });

  // ═══════════════════════════════════════════════
  // unfreeze 测试
  // ═══════════════════════════════════════════════

  describe('unfreeze', () => {
    it('应正确解冻库存（frozen → available）', async () => {
      const batch = makeBatch({
        availableQuantity: '70.0000',
        frozenQuantity: '30.0000',
        freezeStatus: 2,
      });
      const inventory = makeInventory({
        availableQuantity: '70.0000',
        frozenQuantity: '30.0000',
      });

      mockQB.getMany.mockResolvedValue([batch]);
      mockManager.findOne.mockResolvedValue(inventory);

      const result = await service.unfreeze('prod-1', null, 30, 'order-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(30);

      const batchSave = savedEntities.find((e) => e.id === 'batch-1');
      expect(batchSave.frozenQuantity).toBe('0.0000');
      expect(batchSave.availableQuantity).toBe('100.0000');
      expect(batchSave.freezeStatus).toBe(1); // 恢复正常
    });

    it('冻结库存不足时应拒绝解冻', async () => {
      const batch = makeBatch({ frozenQuantity: '10.0000' });
      mockQB.getMany.mockResolvedValue([batch]);

      await expect(service.unfreeze('prod-1', null, 50, 'order-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ═══════════════════════════════════════════════
  // deductFrozen 测试
  // ═══════════════════════════════════════════════

  describe('deductFrozen', () => {
    it('应从冻结库存中扣减', async () => {
      const batch = makeBatch({
        availableQuantity: '70.0000',
        frozenQuantity: '30.0000',
        stockQuantity: '100.0000',
        unitCost: '50.00',
      });
      const inventory = makeInventory({
        availableQuantity: '70.0000',
        frozenQuantity: '30.0000',
        stockQuantity: '100.0000',
      });

      mockQB.getMany.mockResolvedValue([batch]);
      mockManager.findOne.mockResolvedValue(inventory);

      const result = await service.deductFrozen('prod-1', null, 30, 'shipment-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(30);
      expect(result.items[0].totalCost).toBe('1500.00'); // 30 * 50
      expect(result.totalCost).toBe('1500.00');

      // 验证批次 frozen 减少，stock 减少，available 不变
      const batchSave = savedEntities.find((e) => e.id === 'batch-1');
      expect(batchSave.frozenQuantity).toBe('0.0000');
      expect(batchSave.stockQuantity).toBe('70.0000');
    });

    it('冻结库存不足时应拒绝扣减', async () => {
      const batch = makeBatch({ frozenQuantity: '10.0000' });
      mockQB.getMany.mockResolvedValue([batch]);

      await expect(
        service.deductFrozen('prod-1', null, 50, 'shipment-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ═══════════════════════════════════════════════
  // 乐观锁重试测试
  // ═══════════════════════════════════════════════

  describe('乐观锁重试', () => {
    it('业务异常（BadRequestException）不应重试', async () => {
      mockQB.getMany.mockResolvedValue([]);
      let callCount = 0;

      mockDataSource.transaction.mockImplementation(async (cb: Function) => {
        callCount++;
        throw new BadRequestException('库存不足');
      });

      await expect(service.consume('prod-1', null, 50, 'biz-1')).rejects.toThrow(
        BadRequestException,
      );

      expect(callCount).toBe(1); // 只执行一次，不重试
    });

    it('非业务异常应重试最多 3 次', async () => {
      let callCount = 0;

      mockDataSource.transaction.mockImplementation(async () => {
        callCount++;
        throw new Error('deadlock detected');
      });

      await expect(service.consume('prod-1', null, 50, 'biz-1')).rejects.toThrow(
        'deadlock detected',
      );

      expect(callCount).toBe(3); // 重试 3 次
    });

    it('重试成功后应返回正常结果', async () => {
      let callCount = 0;
      const batch = makeBatch({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });
      const inventory = makeInventory({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });

      mockDataSource.transaction.mockImplementation(async (cb: Function) => {
        callCount++;
        if (callCount < 3) {
          throw new Error('deadlock detected');
        }
        // 第三次成功
        return cb(mockManager);
      });

      mockQB.getMany.mockResolvedValue([batch]);
      mockManager.findOne.mockResolvedValue(inventory);

      const result = await service.consume('prod-1', null, 10, 'biz-1');

      expect(callCount).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(10);
    });
  });
});
