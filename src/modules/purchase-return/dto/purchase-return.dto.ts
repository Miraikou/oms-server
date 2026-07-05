import { IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested, IsIn } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto'

/** 采购退货明细项 DTO */
export class CreatePurchaseReturnItemDto {
  @ApiProperty({ description: '采购明细 ID' })
  @IsString()
  @IsNotEmpty({ message: '采购明细不能为空' })
  purchaseOrderItemId: string

  @ApiProperty({ description: '退货数量' })
  @IsString()
  @IsNotEmpty({ message: '退货数量不能为空' })
  quantity: string
}

/** 创建采购退货 DTO */
export class CreatePurchaseReturnDto {
  @ApiProperty({ description: '采购单 ID' })
  @IsString()
  @IsNotEmpty({ message: '采购单不能为空' })
  purchaseOrderId: string

  @ApiProperty({ description: '退货日期' })
  @IsString()
  @IsNotEmpty({ message: '退货日期不能为空' })
  returnDate: string

  @ApiProperty({ description: '是否扣减库存', default: 1 })
  @IsIn([0, 1])
  deductInventory: number

  @ApiPropertyOptional({ description: '退货原因' })
  @IsString()
  @IsOptional()
  reason?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string

  @ApiProperty({ description: '退货明细', type: [CreatePurchaseReturnItemDto] })
  @IsArray({ message: '退货明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReturnItemDto)
  items: CreatePurchaseReturnItemDto[]
}

/** 采购退货查询 DTO */
export class QueryPurchaseReturnDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '退货单号' })
  @IsString()
  @IsOptional()
  returnNo?: string

  @ApiPropertyOptional({ description: '采购单 ID' })
  @IsString()
  @IsOptional()
  purchaseOrderId?: string

  @ApiPropertyOptional({ description: '开始日期' })
  @IsString()
  @IsOptional()
  startDate?: string

  @ApiPropertyOptional({ description: '结束日期' })
  @IsString()
  @IsOptional()
  endDate?: string
}
