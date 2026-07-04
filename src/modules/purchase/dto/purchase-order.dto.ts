import { IsNotEmpty, IsOptional, IsString, IsIn, IsArray, ValidateNested, IsNumber } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 采购明细项 DTO */
export class CreatePurchaseOrderItemDto {
  @ApiProperty({ description: '商品 ID' })
  @IsString()
  @IsNotEmpty({ message: '商品不能为空' })
  productId: string

  @ApiProperty({ description: '采购数量' })
  @IsString()
  @IsNotEmpty({ message: '采购数量不能为空' })
  quantity: string

  @ApiProperty({ description: '采购单价' })
  @IsString()
  @IsNotEmpty({ message: '采购单价不能为空' })
  unitPrice: string
}

/** 创建采购单 DTO */
export class CreatePurchaseOrderDto {
  @ApiProperty({ description: '供应商 ID' })
  @IsString()
  @IsNotEmpty({ message: '供应商不能为空' })
  supplierId: string

  @ApiPropertyOptional({ description: '币种', default: 'CNY' })
  @IsString()
  @IsOptional()
  currency?: string

  @ApiPropertyOptional({ description: '汇率', default: '1.000000' })
  @IsString()
  @IsOptional()
  exchangeRate?: string

  @ApiProperty({ description: '采购日期' })
  @IsString()
  @IsNotEmpty({ message: '采购日期不能为空' })
  purchaseDate: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string

  @ApiProperty({ description: '采购明细', type: [CreatePurchaseOrderItemDto] })
  @IsArray({ message: '采购明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items: CreatePurchaseOrderItemDto[]
}

/** 更新采购单 DTO（仅待入库状态可修改） */
export class UpdatePurchaseOrderDto {
  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string

  @ApiPropertyOptional({ description: '采购明细（整体替换）' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  @IsOptional()
  items?: CreatePurchaseOrderItemDto[]
}

/** 查询采购单 DTO */
export class QueryPurchaseOrderDto {
  @ApiPropertyOptional({ description: '采购单号' })
  @IsString()
  @IsOptional()
  purchaseNo?: string

  @ApiPropertyOptional({ description: '供应商 ID' })
  @IsString()
  @IsOptional()
  supplierId?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsOptional()
  status?: number

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}
