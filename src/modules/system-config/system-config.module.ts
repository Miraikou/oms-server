import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from './entities/system-config.entity';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';
@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig])],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemConfigModule implements OnModuleInit {
  private readonly logger = new Logger(SystemConfigModule.name);

  constructor(private readonly service: SystemConfigService) {}

  /** 初始化默认系统参数 */
  async onModuleInit() {
    const defaults = [
      {
        configKey: 'DEFAULT_COMMISSION_RATE',
        configName: '默认提成比例（%）',
        configValue: '40',
        valueType: 'NUMBER',
      },
      // {
      //   configKey: 'DEFAULT_CURRENCY',
      //   configName: '默认收款币种',
      //   configValue: 'USD',
      //   valueType: 'STRING',
      // },
      {
        configKey: 'LOW_STOCK_WARNING',
        configName: '库存预警阈值',
        configValue: '0',
        valueType: 'NUMBER',
      },
      {
        configKey: 'DEFAULT_EXCHANGE_RATE',
        configName: '默认汇率（USD→CNY）',
        configValue: '6.8',
        valueType: 'NUMBER',
      },
      {
        configKey: 'STOCK_ALERT_EMAIL_ENABLED',
        configName: '库存预警邮件通知',
        configValue: 'false',
        valueType: 'BOOLEAN',
        remark: '开启后库存首次降至预警阈值以下时发送邮件通知',
      },
      {
        configKey: 'STOCK_ALERT_EMAILS',
        configName: '库存预警收件邮箱',
        configValue: '',
        valueType: 'STRING',
        remark: '多个邮箱用英文逗号分隔',
      },
    ];
    for (const item of defaults) {
      const existing = await this.service.getByKey(item.configKey);
      if (existing === null) {
        await this.service.create(item);
        this.logger.log(`已创建默认系统参数: ${item.configKey}`);
      }
    }
  }
}
