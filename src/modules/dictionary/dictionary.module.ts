import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DictionaryService } from './dictionary.service'
import { DictionaryController } from './dictionary.controller'
import { Supplier } from '@/modules/supplier/entities/supplier.entity'
import { Category } from '@/modules/category/entities/category.entity'
import { CostType } from '@/modules/cost-type/entities/cost-type.entity'
import { ExpressCompany } from '@/modules/express-company/entities/express-company.entity'
import { TransportChannel } from '@/modules/transport-channel/entities/transport-channel.entity'
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity'

/**
 * 字典模块
 * 提供固定字典和动态字典的查询服务
 * 动态字典数据来源于已有的基础资料模块
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      Category,
      CostType,
      ExpressCompany,
      TransportChannel,
      Salesperson,
    ]),
  ],
  controllers: [DictionaryController],
  providers: [DictionaryService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
