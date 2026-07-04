import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WinstonModule } from 'nest-winston'
import { RedisModule } from './common/redis/redis.module'
import { AuthModule } from './modules/auth/auth.module'
import { UserModule } from './modules/user/user.module'
import { SupplierModule } from './modules/supplier/supplier.module'
import { CategoryModule } from './modules/category/category.module'
import { ProductModule } from './modules/product/product.module'
import { SalespersonModule } from './modules/salesperson/salesperson.module'
import { ExpressCompanyModule } from './modules/express-company/express-company.module'
import { TransportChannelModule } from './modules/transport-channel/transport-channel.module'
import { CostTypeModule } from './modules/cost-type/cost-type.module'
import { SystemConfigModule } from './modules/system-config/system-config.module'
import { CommonContactModule } from './modules/common-contact/common-contact.module'
import { loggerConfig } from './config/logger.config'
import { AppController } from './app.controller'
import { SequenceModule } from './common/services/sequence.module'
import { DictionaryModule } from './modules/dictionary/dictionary.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { PurchaseModule } from './modules/purchase/purchase.module'
import { SalesOrderModule } from './modules/sales-order/sales-order.module'
import { ShipmentModule } from './modules/shipment/shipment.module'
import { PaymentModule } from './modules/payment/payment.module'

@Module({
  imports: [
    // 环境变量配置
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Winston 日志
    WinstonModule.forRoot(loggerConfig),

    // TypeORM 数据库连接
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql' as const,
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USERNAME', 'root'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_DATABASE', 'oms'),
        charset: 'utf8mb4',
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get<string>('APP_ENV') === 'development',
        logging: configService.get<string>('APP_ENV') === 'development',
        bigNumberStrings: true,
      }),
    }),

    // Redis 全局模块
    RedisModule,

    // 编号生成全局模块
    SequenceModule,

    // 认证 & 用户
    AuthModule,
    UserModule,

    // 基础资料模块
    SupplierModule,
    CategoryModule,
    ProductModule,
    SalespersonModule,
    ExpressCompanyModule,
    TransportChannelModule,
    CostTypeModule,
    SystemConfigModule,
    CommonContactModule,

    // 字典服务
    DictionaryModule,

    // 库存 + 采购 + 订单 + 发货 + 收款
    InventoryModule,
    PurchaseModule,
    SalesOrderModule,
    ShipmentModule,
    PaymentModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
