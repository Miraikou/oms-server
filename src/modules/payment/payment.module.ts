import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { SalesOrderModule } from '@/modules/sales-order/sales-order.module';
import { RateModule as CommonRateModule } from '@/common/rate/rate.module';
import { CommissionModule } from '@/modules/commission/commission.module';

/**
 * 收款模块
 * 包含收款登记、超额校验、订单已收金额更新、提成计提
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment, SalesOrder]), SalesOrderModule, CommonRateModule, CommissionModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
