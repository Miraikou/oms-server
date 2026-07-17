import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity';
import { PurchaseReceipt } from './entities/purchase-receipt.entity';
import { PurchaseReceiptItem } from './entities/purchase-receipt-item.entity';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity';
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseReceiptService } from './purchase-receipt.service';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseReceiptController } from './purchase-receipt.controller';
import { RateModule as CommonRateModule } from '@/common/rate/rate.module';

/**
 * 采购模块
 * 包含采购订单和采购入库两个核心功能
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseOrder,
      PurchaseOrderItem,
      PurchaseReceipt,
      PurchaseReceiptItem,
      Inventory,
      InventoryBatch,
      InventoryFlow,
      ProductModel,
      Product,
    ]),
    CommonRateModule,
  ],
  controllers: [PurchaseOrderController, PurchaseReceiptController],
  providers: [PurchaseOrderService, PurchaseReceiptService],
  exports: [PurchaseOrderService, PurchaseReceiptService],
})
export class PurchaseModule {}
