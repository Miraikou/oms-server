import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductModel } from './entities/product-model.entity';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ProductModelService } from './product-model.service';
import { ProductModelController } from './product-model.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductModel])],
  controllers: [ProductController, ProductModelController],
  providers: [ProductService, ProductModelService],
  exports: [ProductService, ProductModelService],
})
export class ProductModule {}
