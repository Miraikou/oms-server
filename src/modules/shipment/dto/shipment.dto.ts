import { IsNotEmpty, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto'

/** 发货明细项 DTO */
export class CreateShipmentItemDto {
  @ApiProperty({ description: '订单商品 ID' })
  @IsString()
  @IsNotEmpty({ message: '订单商品不能为空' })
  orderItemId: string

  @ApiProperty({ description: '发货数量' })
  @IsString()
  @IsNotEmpty({ message: '发货数量不能为空' })
  quantity: string
}

/** 创建发货单 DTO */
export class CreateShipmentDto {
  @ApiProperty({ description: '订单 ID' })
  @IsString()
  @IsNotEmpty({ message: '订单不能为空' })
  orderId: string

  @ApiProperty({ description: '快递公司 ID' })
  @IsString()
  @IsNotEmpty({ message: '快递公司不能为空' })
  expressCompanyId: string

  @ApiProperty({ description: '快递单号' })
  @IsString()
  @IsNotEmpty({ message: '快递单号不能为空' })
  trackingNo: string

  @ApiProperty({ description: '发货日期' })
  @IsString()
  @IsNotEmpty({ message: '发货日期不能为空' })
  shipmentDate: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string

  @ApiProperty({ description: '发货明细（至少一项）', type: [CreateShipmentItemDto] })
  @IsArray({ message: '发货明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreateShipmentItemDto)
  items: CreateShipmentItemDto[]
}

/** 发货查询 DTO */
export class QueryShipmentDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '发货单号（模糊）' })
  @IsString()
  @IsOptional()
  shipmentNo?: string

  @ApiPropertyOptional({ description: '订单 ID' })
  @IsString()
  @IsOptional()
  orderId?: string

  @ApiPropertyOptional({ description: '快递公司 ID' })
  @IsString()
  @IsOptional()
  expressCompanyId?: string

  @ApiPropertyOptional({ description: '快递单号（模糊）' })
  @IsString()
  @IsOptional()
  trackingNo?: string

  @ApiPropertyOptional({ description: '开始日期' })
  @IsString()
  @IsOptional()
  startDate?: string

  @ApiPropertyOptional({ description: '结束日期' })
  @IsString()
  @IsOptional()
  endDate?: string
}
