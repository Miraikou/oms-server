import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommissionLedger } from './entities/commission-ledger.entity';
import { CommissionSettlement } from './entities/commission-settlement.entity';
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity';
import { SalesOrderCost } from '@/modules/sales-order/entities/sales-order-cost.entity';
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity';
import { CommissionService } from './commission.service';
import { CommissionController } from './commission.controller';

/**
 * 提成模块 ⭐
 * 提供提成计提、冲回、结算功能
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([
			CommissionLedger,
			CommissionSettlement,
			Salesperson,
			SalesOrder,
			SalesOrderItem,
			SalesOrderCost,
			ShipmentItem,
		]),
	],
	controllers: [CommissionController],
	providers: [CommissionService],
	exports: [CommissionService],
})
export class CommissionModule {}
