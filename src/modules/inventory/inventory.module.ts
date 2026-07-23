import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inventory } from './entities/inventory.entity';
import { InventoryBatch } from './entities/inventory-batch.entity';
import { InventoryFlow } from './entities/inventory-flow.entity';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import { InventoryAdjustmentItem } from './entities/inventory-adjustment-item.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { InventoryService } from './inventory.service';
import { FifoService } from './services/fifo.service';
import { StockAlertService } from './services/stock-alert.service';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { InventoryController } from './inventory.controller';
import { InventoryBatchController } from './inventory-batch.controller';
import { InventoryFlowController } from './inventory-flow.controller';
import { InventoryAdjustmentController } from './inventory-adjustment.controller';
import { RateModule } from '@/common/rate/rate.module';
import { MailModule } from '@/common/mail/mail.module';
import { SystemConfigModule } from '@/modules/system-config/system-config.module';

/**
 * 库存管理模块
 * 包含：库存查询、FIFO 引擎、库存冻结/解冻、库存调整、库存流水、库存预警通知
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Inventory,
      InventoryBatch,
      InventoryFlow,
      InventoryAdjustment,
      InventoryAdjustmentItem,
      Product,
      ProductModel,
    ]),
    RateModule,
    MailModule,
    SystemConfigModule,
  ],
  controllers: [
    InventoryController,
    InventoryBatchController,
    InventoryFlowController,
    InventoryAdjustmentController,
  ],
  providers: [InventoryService, FifoService, StockAlertService, InventoryAdjustmentService],
  exports: [InventoryService, FifoService, StockAlertService],
})
export class InventoryModule {}
