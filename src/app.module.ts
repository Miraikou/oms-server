import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WinstonModule } from 'nest-winston';
import { RedisModule } from './common/redis/redis.module';
import { OssModule } from './common/oss/oss.module';
import { RoleModule } from './modules/role/role.module';
import { MenuModule } from './modules/menu/menu.module';
import { OperationLogModule } from './modules/operation-log/operation-log.module';
import { LoginLogModule } from './modules/login-log/login-log.module';
import { UploadModule } from './modules/upload/upload.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { CategoryModule } from './modules/category/category.module';
import { ProductModule } from './modules/product/product.module';
import { SalespersonModule } from './modules/salesperson/salesperson.module';
import { ExpressCompanyModule } from './modules/express-company/express-company.module';
import { TransportChannelModule } from './modules/transport-channel/transport-channel.module';
import { CostTypeModule } from './modules/cost-type/cost-type.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';
import { CommonContactModule } from './modules/common-contact/common-contact.module';
import { loggerConfig } from './config/logger.config';
import { AppController } from './app.controller';
import { SequenceModule } from './common/services/sequence.module';
import { DictionaryModule } from './modules/dictionary/dictionary.module';
import { DictManageModule } from './modules/dict-manage/dict-manage.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { SalesOrderModule } from './modules/sales-order/sales-order.module';
import { ShipmentModule } from './modules/shipment/shipment.module';
import { PaymentModule } from './modules/payment/payment.module';
import { SalesReturnModule } from './modules/sales-return/sales-return.module';
import { PurchaseReturnModule } from './modules/purchase-return/purchase-return.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CommissionModule } from './modules/commission/commission.module';
import { RateModule } from './modules/rate/rate.module';
import { HelpDocModule } from './modules/help-doc/help-doc.module';
import { AuditSubscriber } from './common/subscribers/audit.subscriber';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';

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
        subscribers: [AuditSubscriber],
      }),
    }),

    // Redis 全局模块
    RedisModule,

    // OSS 全局模块
    OssModule,

    // 编号生成全局模块
    SequenceModule,

    // RBAC 权限模块（必须在 Auth/User 之前初始化种子数据）
    RoleModule,
    MenuModule,
    OperationLogModule,
    LoginLogModule,

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

    // 通用上传
    UploadModule,

    // 字典服务
    DictionaryModule,
    DictManageModule,

    // 库存 + 采购 + 订单 + 发货 + 收款 + 退货
    InventoryModule,
    PurchaseModule,
    SalesOrderModule,
    ShipmentModule,
    PaymentModule,
    SalesReturnModule,
    PurchaseReturnModule,

    // 提成管理
    CommissionModule,

    // 驾驶舱
    DashboardModule,

    RateModule,

    // 帮助文档（用户手册）
    HelpDocModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*')
  }
}
