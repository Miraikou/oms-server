import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Salesperson } from './entities/salesperson.entity';
import { SalespersonService } from './salesperson.service';
import { SalespersonController } from './salesperson.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Salesperson])],
  controllers: [SalespersonController],
  providers: [SalespersonService],
  exports: [SalespersonService],
})
export class SalespersonModule {}
