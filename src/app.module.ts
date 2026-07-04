import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WinstonModule } from 'nest-winston'
import { RedisModule } from './common/redis/redis.module'
import { loggerConfig } from './config/logger.config'
import { AppController } from './app.controller'

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
  ],
  controllers: [AppController],
})
export class AppModule {}
