import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 客户退货明细项 DTO */
export class CreateSalesReturnItemDto {
  @ApiProperty({ description: '发货明细 ID' })
  @IsString()
  @IsNotEmpty({ message: '发货明细不能为空' })
  shipmentItemId: string;

  @ApiProperty({ description: '退货数量' })
  @IsString()
  @IsNotEmpty({ message: '退货数量不能为空' })
  quantity: string;
}

/** 创建客户退货 DTO */
export class CreateSalesReturnDto {
  @ApiProperty({ description: '订单 ID' })
  @IsString()
  @IsNotEmpty({ message: '订单不能为空' })
  orderId: string;

  @ApiProperty({ description: '退货日期' })
  @IsString()
  @IsNotEmpty({ message: '退货日期不能为空' })
  returnDate: string;

  @ApiProperty({ description: '是否恢复库存', default: 1 })
  @IsIn([0, 1])
  restoreInventory: number;

  @ApiPropertyOptional({ description: '退货原因' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ description: '是否退款', default: false })
  @IsBoolean()
  refund: boolean = false;

  @ApiPropertyOptional({ description: '退款方式' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: '退货成本（可为 0）', default: '0' })
  @IsString()
  @IsOptional()
  returnCost?: string;

  @ApiPropertyOptional({ description: '退货成本币种', default: 'CNY' })
  @IsString()
  @IsOptional()
  returnCostCurrency?: string;

  @ApiProperty({ description: '退货明细', type: [CreateSalesReturnItemDto] })
  @IsArray({ message: '退货明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreateSalesReturnItemDto)
  items: CreateSalesReturnItemDto[];
}

/** 客户退货查询 DTO */
export class QuerySalesReturnDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '退货单号' })
  @IsString()
  @IsOptional()
  returnNo?: string;

  @ApiPropertyOptional({ description: '订单 ID' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
