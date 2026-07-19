import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesOrder } from './entities/sales-order.entity';
import { SalesOrderItem } from './entities/sales-order-item.entity';
import { SalesOrderCost } from './entities/sales-order-cost.entity';
import { Inventory } from '@/modules/inventory/entities/inventory.entity';
import { InventoryBatch } from '@/modules/inventory/entities/inventory-batch.entity';
import { InventoryFlow } from '@/modules/inventory/entities/inventory-flow.entity';
import { CommonContact } from '@/modules/common-contact/entities/common-contact.entity';
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity';
import { CostType } from '@/modules/cost-type/entities/cost-type.entity';
import { Payment } from '@/modules/payment/entities/payment.entity';
import { Product } from '@/modules/product/entities/product.entity';
import { ProductModel } from '@/modules/product/entities/product-model.entity';
import { SalesOrderService } from './sales-order.service';
import { SalesOrderCostService } from './sales-order-cost.service';
import { SalesOrderController } from './sales-order.controller';
import { InventoryModule } from '@/modules/inventory/inventory.module';
import { RateModule as CommonRateModule } from '@/common/rate/rate.module';
import { DashboardModule } from '@/modules/dashboard/dashboard.module';

/**
 * 销售订单模块
 * 包含订单 CRUD、订单成本管理、库存冻结/解冻
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesOrder,
      SalesOrderItem,
      SalesOrderCost,
      Inventory,
      InventoryBatch,
      InventoryFlow,
      CommonContact,
      ShipmentItem,
      CostType,
      Payment,
      Product,
      ProductModel,
    ]),
    InventoryModule,
    CommonRateModule,
    DashboardModule,
  ],
  controllers: [SalesOrderController],
  providers: [SalesOrderService, SalesOrderCostService],
  exports: [SalesOrderService, SalesOrderCostService],
})
export class SalesOrderModule {}
