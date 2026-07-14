import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inventory } from './entities/inventory.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { InventoryAdjustmentItem } from './entities/inventory-adjustment-item.entity';
import { InventoryService } from './inventory.service';
import { FifoService } from './services/fifo.service';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { InventoryController } from './inventory.controller';
import { InventoryBatchController } from './inventory-batch.controller';
import { InventoryFlowController } from './inventory-flow.controller';
import { InventoryAdjustmentController } from './inventory-adjustment.controller';
import { RateModule } from '@/common/rate/rate.module';

/**
 * 库存管理模块
 * 包含：库存查询、FIFO 引擎、库存冻结/解冻、库存调整、库存流水
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Inventory,
      InventoryBatch,
      InventoryFlow,
      InventoryAdjustment,
      InventoryAdjustmentItem,
    ]),
    RateModule,
  ],
  controllers: [
    InventoryController,
    InventoryBatchController,
    InventoryFlowController,
    InventoryAdjustmentController,
  ],
  providers: [InventoryService, FifoService, InventoryAdjustmentService],
  exports: [InventoryService, FifoService],
})
export class InventoryModule {}
