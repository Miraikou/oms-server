import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SalesReturn } from './entities/sales-return.entity'
import { SalesReturnItem } from './entities/sales-return-item.entity'
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity'
import { ShipmentItemBatch } from '@/modules/shipment/entities/shipment-item-batch.entity'
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity'
import { Inventory } from '@/modules/inventory/entities/inventory.entity'
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity'
import { SalesReturnService } from './sales-return.service'
import { SalesReturnController } from './sales-return.controller'
import { SalesOrderModule } from '@/modules/sales-order/sales-order.module'

/**
 * 客户退货模块
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesReturn,
      SalesReturnItem,
      ShipmentItem,
      ShipmentItemBatch,
      InventoryBatch,
      Inventory,
      InventoryFlow,
      SalesOrder,
      SalesOrderItem,
    ]),
    SalesOrderModule,
  ],
  controllers: [SalesReturnController],
  providers: [SalesReturnService],
  exports: [SalesReturnService],
})
export class SalesReturnModule {}
