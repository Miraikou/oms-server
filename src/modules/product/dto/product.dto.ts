import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto'

export class CreateProductDto {
  @ApiProperty({ description: '供应商 ID' })
  @IsString()
  @IsNotEmpty({ message: '供应商不能为空' })
  supplierId: string

  @ApiPropertyOptional({ description: '商品分类 ID' })
  @IsString()
  @IsOptional()
  categoryId?: string

  @ApiProperty({ description: '商品名称' })
  @IsString()
  @IsNotEmpty({ message: '商品名称不能为空' })
  productName: string

  @ApiProperty({ description: '产品型号' })
  @IsString()
  @IsNotEmpty({ message: '产品型号不能为空' })
  productModel: string

  @ApiPropertyOptional({ description: '商品图片 URL' })
  @IsString()
  @IsOptional()
  imageUrl?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateProductDto {
  @ApiPropertyOptional({ description: '商品分类 ID' })
  @IsString()
  @IsOptional()
  categoryId?: string

  @ApiPropertyOptional({ description: '商品名称' })
  @IsString()
  @IsOptional()
  productName?: string

  @ApiPropertyOptional({ description: '商品图片 URL' })
  @IsString()
  @IsOptional()
  imageUrl?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class QueryProductDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词（名称/型号）' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '供应商 ID' })
  @IsString()
  @IsOptional()
  supplierId?: string

  @ApiPropertyOptional({ description: '分类 ID' })
  @IsString()
  @IsOptional()
  categoryId?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number
}
