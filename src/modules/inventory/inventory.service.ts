import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from './entities/inventory.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 库存基础服务
 * 提供库存批次创建、库存汇总更新、库存流水写入等基础方法
 * FIFO 引擎将在步骤 06 中扩展此服务
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventoryBatch)
    private readonly batchRepo: Repository<InventoryBatch>,
    @InjectRepository(InventoryFlow)
    private readonly flowRepo: Repository<InventoryFlow>,
  ) {}

  /**
   * 创建库存批次
   * @param data 批次数据
   */
  async createBatch(data: {
    productId: string;
    productModelId?: string | null;
    receiptItemId: string | null;
    batchSource: number;
    batchNo: string;
    unitCost: string;
    quantity: string;
    inboundTime: Date;
    createdBy?: string | null;
  }): Promise<InventoryBatch> {
    const batch = this.batchRepo.create({
      id: snowflake.nextId(),
      productId: data.productId,
      productModelId: data.productModelId || null,
      receiptItemId: data.receiptItemId,
      batchSource: data.batchSource,
      batchNo: data.batchNo,
      unitCost: data.unitCost,
      originalQuantity: data.quantity,
      availableQuantity: data.quantity,
      frozenQuantity: '0',
      stockQuantity: data.quantity,
      inboundTime: data.inboundTime,
      freezeStatus: 1,
      status: 1,
      createdBy: data.createdBy || null,
    });
    return this.batchRepo.save(batch);
  }

  /**
   * 更新库存汇总（不存在则创建）
   * @param productId 商品 ID
   * @param productModelId 型号 ID（可选）
   * @param quantityDelta 可用库存变化量（正数增加，负数减少）
   */
  async updateInventorySummary(
    productId: string,
    productModelId: string | null | undefined,
    quantityDelta: number,
    createdBy?: string | null,
  ): Promise<Inventory> {
    const where: Record<string, unknown> = { productId };
    if (productModelId) {
      where.productModelId = productModelId;
    } else {
      where.productModelId = undefined as any; // IS NULL
    }

    let inventory = await this.inventoryRepo.findOne({ where });

    if (!inventory) {
      // 首次入库，创建库存汇总记录
      inventory = this.inventoryRepo.create({
        id: snowflake.nextId(),
        productId,
        productModelId: productModelId || null,
        availableQuantity: String(quantityDelta),
        frozenQuantity: '0',
        stockQuantity: String(quantityDelta),
        minimumStock: '0',
        createdBy: createdBy || null,
        version: 0,
      });
    } else {
      const available = parseFloat(inventory.availableQuantity) + quantityDelta;
      const stock = parseFloat(inventory.stockQuantity) + quantityDelta;
      inventory.availableQuantity = String(available);
      inventory.stockQuantity = String(stock);
      inventory.updatedBy = createdBy || null;
      inventory.version += 1;
    }

    return this.inventoryRepo.save(inventory);
  }

  /**
   * 写入库存流水
   * @param data 流水数据
   */
  async writeFlow(data: {
    batchId: string;
    productId: string;
    productModelId?: string | null;
    businessType: number;
    businessId: string;
    changeType: number;
    quantity: string;
    unitCost?: string | null;
    totalCost?: string | null;
    beforeAvailable: string;
    afterAvailable: string;
    beforeFrozen: string;
    afterFrozen: string;
    createdBy?: string | null;
    remark?: string | null;
  }): Promise<InventoryFlow> {
    const flow = this.flowRepo.create({
      id: snowflake.nextId(),
      ...data,
      productModelId: data.productModelId || null,
    });
    return this.flowRepo.save(flow);
  }

  /** 获取库存汇总 Repository（供事务中使用） */
  getInventoryRepo(): Repository<Inventory> {
    return this.inventoryRepo;
  }

  /** 获取库存批次 Repository（供事务中使用） */
  getBatchRepo(): Repository<InventoryBatch> {
    return this.batchRepo;
  }

  /** 获取库存流水 Repository（供事务中使用） */
  getFlowRepo(): Repository<InventoryFlow> {
    return this.flowRepo;
  }
}
