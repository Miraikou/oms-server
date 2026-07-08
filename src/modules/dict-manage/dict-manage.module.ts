import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysDictType } from './entities/sys-dict-type.entity';
import { SysDictItem } from './entities/sys-dict-item.entity';
import { DictTypeService } from './dict-type.service';
import { DictItemService } from './dict-item.service';
import { DictTypeController, DictItemController } from './dict-manage.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SysDictType, SysDictItem])],
  controllers: [DictTypeController, DictItemController],
  providers: [DictTypeService, DictItemService],
  exports: [DictTypeService, DictItemService],
})
export class DictManageModule {}
