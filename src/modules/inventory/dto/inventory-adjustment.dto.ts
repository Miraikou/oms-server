import { IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 调整明细 DTO */
export class CreateAdjustmentItemDto {
  @ApiProperty({ description: '商品 ID' })
  @IsString()
  @IsNotEmpty({ message: '商品不能为空' })
  productId: string

  @ApiPropertyOptional({ description: '指定批次 ID（为空则自动处理）' })
  @IsString()
  @IsOptional()
  batchId?: string

  @ApiProperty({ description: '调整数量（正=增加，负=减少）' })
  @IsString()
  @IsNotEmpty({ message: '调整数量不能为空' })
  changeQuantity: string
}

/** 创建库存调整 DTO */
export class CreateInventoryAdjustmentDto {
  @ApiProperty({ description: '调整原因' })
  @IsString()
  @IsNotEmpty({ message: '调整原因不能为空' })
  reason: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string

  @ApiProperty({ description: '调整明细', type: [CreateAdjustmentItemDto] })
  @IsArray({ message: '调整明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreateAdjustmentItemDto)
  items: CreateAdjustmentItemDto[]
}

/** 查询库存调整 DTO */
export class QueryInventoryAdjustmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}

/** 查询库存列表 DTO */
export class QueryInventoryDto {
  @ApiPropertyOptional({ description: '关键词（商品名）' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '供应商 ID' })
  @IsString()
  @IsOptional()
  supplierId?: string

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}

/** 查询库存流水 DTO */
export class QueryInventoryFlowDto {
  @ApiPropertyOptional({ description: '商品 ID' })
  @IsString()
  @IsOptional()
  productId?: string

  @ApiPropertyOptional({ description: '业务类型' })
  @IsOptional()
  businessType?: number

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}
