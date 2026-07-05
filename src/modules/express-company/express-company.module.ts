import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExpressCompany } from './entities/express-company.entity';
import { ExpressCompanyService } from './express-company.service';
import { ExpressCompanyController } from './express-company.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExpressCompany])],
  controllers: [ExpressCompanyController],
  providers: [ExpressCompanyService],
  exports: [ExpressCompanyService],
})
export class ExpressCompanyModule {}
