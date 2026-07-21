import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CostType } from './entities/cost-type.entity';
import { CostTypeService } from './cost-type.service';
import { CostTypeController } from './cost-type.controller';
@Module({
  imports: [TypeOrmModule.forFeature([CostType])],
  controllers: [CostTypeController],
  providers: [CostTypeService],
  exports: [CostTypeService],
})
export class CostTypeModule implements OnModuleInit {
  private readonly logger = new Logger(CostTypeModule.name);

  constructor(private readonly service: CostTypeService) {}

  /** 初始化默认成本类型 */
  async onModuleInit() {
    const defaults = [
      '其他成本',
      '客户退货成本',
      '扣关成本',
      '营销成本',
      '广告成本',
      '物流成本',
    ];
    for (const name of defaults) {
      const existing = await this.service.findAll({
        keyword: name,
        page: 1,
        pageSize: 1,
      });
      if (existing.total === 0) {
        await this.service.create({ costName: name });
        this.logger.log(`已创建默认成本类型: ${name}`);
      }
    }
  }
}
