import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 入库明细项 DTO */
export class CreatePurchaseReceiptItemDto {
  @ApiProperty({ description: '采购明细 ID' })
  @IsString()
  @IsNotEmpty({ message: '采购明细不能为空' })
  purchaseOrderItemId: string;

  @ApiProperty({ description: '入库数量' })
  @IsString()
  @IsNotEmpty({ message: '入库数量不能为空' })
  quantity: string;
}

/** 创建入库单 DTO */
export class CreatePurchaseReceiptDto {
  @ApiProperty({ description: '采购单 ID' })
  @IsString()
  @IsNotEmpty({ message: '采购单不能为空' })
  purchaseOrderId: string;

  @ApiPropertyOptional({ description: '入库时间', default: '当前时间' })
  @IsString()
  @IsOptional()
  receiptDate?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiProperty({
    description: '入库明细',
    type: [CreatePurchaseReceiptItemDto],
  })
  @IsArray({ message: '入库明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReceiptItemDto)
  items: CreatePurchaseReceiptItemDto[];
}

/** 查询入库单 DTO */
export class QueryPurchaseReceiptDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '采购单 ID' })
  @IsString()
  @IsOptional()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ description: '入库单号' })
  @IsString()
  @IsOptional()
  receiptNo?: string;

  @ApiPropertyOptional({ description: '采购单号' })
  @IsString()
  @IsOptional()
  purchaseNo?: string;

  @ApiPropertyOptional({ description: '入库日期起' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: '入库日期止' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
