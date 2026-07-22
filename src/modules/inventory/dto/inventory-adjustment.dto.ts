import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsInt,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 调整明细 DTO */
export class CreateAdjustmentItemDto {
  @ApiProperty({ description: '商品 ID' })
  @IsString()
  @IsNotEmpty({ message: '商品不能为空' })
  productId: string;

  @ApiPropertyOptional({ description: '商品型号 ID' })
  @IsString()
  @IsOptional()
  productModelId?: string;

  @ApiPropertyOptional({ description: '指定批次 ID（为空则自动处理）' })
  @IsString()
  @IsOptional()
  batchId?: string;

  @ApiProperty({ description: '调整数量（正=增加，负=减少）' })
  @IsString()
  @IsNotEmpty({ message: '调整数量不能为空' })
  changeQuantity: string;

  @ApiPropertyOptional({
    description: '成本来源：1=近一年加权平均 2=剩余库存加权平均 3=最新采购记录成本 4=手动输入（仅增加+未指定批次时必填）',
  })
  @IsInt()
  @Min(1)
  @Max(4)
  @IsOptional()
  costSourceType?: number;

  @ApiPropertyOptional({ description: '手动输入单价（costSourceType=4 时必填）' })
  @IsString()
  @IsOptional()
  unitPrice?: string;

  @ApiPropertyOptional({ description: '成本币种（costSourceType=4 时必填，默认 CNY）' })
  @IsString()
  @IsOptional()
  currency?: string;
}

/** 创建库存调整 DTO */
export class CreateInventoryAdjustmentDto {
  @ApiProperty({ description: '调整原因' })
  @IsString()
  @IsNotEmpty({ message: '调整原因不能为空' })
  reason: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiProperty({ description: '调整明细', type: [CreateAdjustmentItemDto] })
  @IsArray({ message: '调整明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreateAdjustmentItemDto)
  items: CreateAdjustmentItemDto[];
}

/** 查询库存调整 DTO */
export class QueryInventoryAdjustmentDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '调整单号' })
  @IsString()
  @IsOptional()
  adjustmentNo?: string;

  @ApiPropertyOptional({ description: '调整原因' })
  @IsString()
  @IsOptional()
  reason?: string;
}

/** 查询库存列表 DTO */
export class QueryInventoryDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词（商品名）' })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ description: '供应商 ID' })
  @IsString()
  @IsOptional()
  supplierId?: string;
}

/** 查询库存流水 DTO */
export class QueryInventoryFlowDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '商品 ID' })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional({ description: '业务类型' })
  @IsOptional()
  businessType?: number;
}

/** 查询库存树形列表 DTO */
export class QueryInventoryTreeDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '商品 ID（精确筛选）' })
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional({ description: '仅显示低库存商品（1=仅低库存）' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  lowStock?: number;
}

/** 成本估算请求 DTO */
export class EstimateCostDto {
  @ApiProperty({ description: '商品 ID' })
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiPropertyOptional({ description: '商品型号 ID（为空则匹配型号为空的批次）' })
  @IsString()
  @IsOptional()
  productModelId?: string;

  @ApiProperty({ description: '成本来源类型：1=近一年加权平均 2=剩余库存加权平均 3=最新采购记录成本' })
  @IsInt()
  @Min(1)
  @Max(3)
  costSourceType: number;
}
