import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Salesperson } from './entities/salesperson.entity';
import { SalespersonService } from './salesperson.service';
import { SalespersonController } from './salesperson.controller';
import { RoleModule } from '../role/role.module';

@Module({
  imports: [TypeOrmModule.forFeature([Salesperson]), RoleModule],
  controllers: [SalespersonController],
  providers: [SalespersonService],
  exports: [SalespersonService],
})
export class SalespersonModule {}
