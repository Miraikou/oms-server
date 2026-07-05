import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseReturn } from './entities/purchase-return.entity';
import { PurchaseReturnItem } from './entities/purchase-return-item.entity';
import { PurchaseOrder } from '@/modules/purchase/entities/purchase-order.entity';
import { PurchaseOrderItem } from '@/modules/purchase/entities/purchase-order-item.entity';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnController } from './purchase-return.controller';
import { InventoryModule } from '@/modules/inventory/inventory.module';

/**
 * 采购退货模块
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PurchaseReturn,
      PurchaseReturnItem,
      PurchaseOrder,
      PurchaseOrderItem,
    ]),
    InventoryModule,
  ],
  controllers: [PurchaseReturnController],
  providers: [PurchaseReturnService],
  exports: [PurchaseReturnService],
})
export class PurchaseReturnModule {}
