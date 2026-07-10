import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 创建商品时内嵌的型号 DTO */
export class CreateProductModelInlineDto {
  @ApiProperty({ description: '型号名称' })
  @IsString()
  @IsNotEmpty({ message: '型号名称不能为空' })
  modelName: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}

/** 编辑商品时内嵌的型号 DTO（含可选 id，用于区分新增/更新） */
export class UpdateProductModelInlineDto extends CreateProductModelInlineDto {
  @ApiPropertyOptional({ description: '型号 ID（有值表示更新已有型号，无值表示新增）' })
  @IsString()
  @IsOptional()
  id?: string;
}

export class CreateProductDto {
  @ApiProperty({ description: '供应商 ID' })
  @IsString()
  @IsNotEmpty({ message: '供应商不能为空' })
  supplierId: string;

  @ApiPropertyOptional({ description: '商品分类 ID' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiProperty({ description: '商品名称' })
  @IsString()
  @IsNotEmpty({ message: '商品名称不能为空' })
  productName: string;

  @ApiPropertyOptional({ description: '商品图片 URL' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ description: '商品型号列表（可选，创建时一并添加）', type: [CreateProductModelInlineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductModelInlineDto)
  @IsOptional()
  models?: CreateProductModelInlineDto[];
}

export class UpdateProductDto {
  @ApiProperty({ description: '供应商 ID' })
  @IsString()
  @IsNotEmpty({ message: '供应商不能为空' })
  supplierId: string;

  @ApiPropertyOptional({ description: '商品分类 ID' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: '商品名称' })
  @IsString()
  @IsOptional()
  productName?: string;

  @ApiPropertyOptional({ description: '商品图片 URL' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ description: '商品型号列表（可选，编辑时同步型号）', type: [UpdateProductModelInlineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProductModelInlineDto)
  @IsOptional()
  models?: UpdateProductModelInlineDto[];
}

export class QueryProductDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词（名称）' })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ description: '供应商 ID' })
  @IsString()
  @IsOptional()
  supplierId?: string;

  @ApiPropertyOptional({ description: '分类 ID' })
  @IsString()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}
