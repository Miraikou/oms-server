import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Shipment } from './entities/shipment.entity'
import { ShipmentItem } from './entities/shipment-item.entity'
import { ShipmentItemBatch } from './entities/shipment-item-batch.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity'
import { ShipmentService } from './shipment.service'
import { ShipmentController } from './shipment.controller'
import { InventoryModule } from '@/modules/inventory/inventory.module'
import { SalesOrderModule } from '@/modules/sales-order/sales-order.module'

/**
 * 发货模块
 * 包含发货单创建（含 FIFO 扣减）、发货预览、发货详情查询
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Shipment,
      ShipmentItem,
      ShipmentItemBatch,
      SalesOrder,
      SalesOrderItem,
    ]),
    InventoryModule,
    SalesOrderModule,
  ],
  controllers: [ShipmentController],
  providers: [ShipmentService],
  exports: [ShipmentService],
})
export class ShipmentModule {}
