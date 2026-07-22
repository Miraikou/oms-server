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
    unitCostUsd: '50.00',
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
      mockQB.getOne.mockResolvedValue(inventory);

      const result = await service.consume('prod-1', null, 50, 'biz-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(50);
      expect(result.items[0].unitCostUsd).toBe('50.00');
      expect(result.items[0].totalCostUsd).toBe('2500.00');
      expect(result.totalCostUsd).toBe('2500.00');
    });

    it('应跨批次扣减（FIFO 顺序）', async () => {
      const batch1 = makeBatch({
        id: 'batch-1',
        batchNo: 'BT001',
        availableQuantity: '30.0000',
        stockQuantity: '30.0000',
        unitCostUsd: '40.00',
        inboundTime: new Date('2026-01-01'),
      });
      const batch2 = makeBatch({
        id: 'batch-2',
        batchNo: 'BT002',
        availableQuantity: '70.0000',
        stockQuantity: '70.0000',
        unitCostUsd: '60.00',
        inboundTime: new Date('2026-02-01'),
      });
      const inventory = makeInventory({
        availableQuantity: '100.0000',
        stockQuantity: '100.0000',
      });

      mockQB.getMany.mockResolvedValue([batch1, batch2]);
      mockQB.getOne.mockResolvedValue(inventory);

      const result = await service.consume('prod-1', null, 50, 'biz-1');

      expect(result.items).toHaveLength(2);
      // 第一批扣 30
      expect(result.items[0].batchId).toBe('batch-1');
      expect(result.items[0].quantity).toBe(30);
      expect(result.items[0].totalCostUsd).toBe('1200.00'); // 30 * 40
      // 第二批扣 20
      expect(result.items[1].batchId).toBe('batch-2');
      expect(result.items[1].quantity).toBe(20);
      expect(result.items[1].totalCostUsd).toBe('1200.00'); // 20 * 60
      // 总成本 = 1200 + 1200 = 2400
      expect(result.totalCostUsd).toBe('2400.00');
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
      mockQB.getOne.mockResolvedValue(inventory);

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
      mockQB.getOne.mockResolvedValue(inventory);

      await service.consume('prod-1', null, 50, 'biz-1');

      // batch save 应在 inventory save 之前
      const batchSave = savedEntities.find((e) => e.id === 'batch-1');
      expect(batchSave.status).toBe(2);
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
      mockQB.getOne.mockResolvedValue(inventory);

      const result = await service.consume('prod-1', null, 10, 'biz-1');

      expect(callCount).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(10);
    });
  });
});
