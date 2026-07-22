import {
	IsNotEmpty,
	IsOptional,
	IsString,
	IsArray,
	IsInt,
	ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 采购明细项 DTO */
export class CreatePurchaseOrderItemDto {
	@ApiProperty({ description: '商品 ID' })
	@IsString()
	@IsNotEmpty({ message: '商品不能为空' })
	productId: string;

	@ApiPropertyOptional({ description: '商品型号 ID' })
	@IsString()
	@IsOptional()
	productModelId?: string;

	@ApiProperty({ description: '采购数量' })
	@IsString()
	@IsNotEmpty({ message: '采购数量不能为空' })
	quantity: string;

	@ApiProperty({ description: '采购单价' })
	@IsString()
	@IsNotEmpty({ message: '采购单价不能为空' })
	unitPrice: string;
}

/** 创建采购单 DTO */
export class CreatePurchaseOrderDto {
	@ApiProperty({ description: '供应商 ID' })
	@IsString()
	@IsNotEmpty({ message: '供应商不能为空' })
	supplierId: string;

	@ApiPropertyOptional({ description: '币种', default: 'CNY' })
	@IsString()
	@IsNotEmpty({ message: '币种不能为空' })
	currency: string;

	@ApiPropertyOptional({ description: '汇率', default: '1' })
	@IsString()
	@IsOptional()
	exchangeRate?: string;

	@ApiProperty({ description: '采购日期' })
	@IsString()
	@IsNotEmpty({ message: '采购日期不能为空' })
	purchaseDate: string;

	@ApiPropertyOptional({ description: '备注' })
	@IsString()
	@IsOptional()
	remark?: string;

	@ApiProperty({
		description: '采购明细',
		type: [CreatePurchaseOrderItemDto],
	})
	@IsArray({ message: '采购明细不能为空' })
	@ValidateNested({ each: true })
	@Type(() => CreatePurchaseOrderItemDto)
	items: CreatePurchaseOrderItemDto[];
}

/** 更新采购单 DTO（仅待入库状态可修改） */
export class UpdatePurchaseOrderDto {
	@ApiPropertyOptional({ description: '供应商 ID' })
	@IsString()
	@IsOptional()
	supplierId?: string;

	@ApiPropertyOptional({ description: '币种', default: 'CNY' })
	@IsString()
	@IsOptional()
	currency?: string;

	@ApiPropertyOptional({ description: '汇率', default: '1' })
	@IsString()
	@IsOptional()
	exchangeRate?: string;

	@ApiPropertyOptional({ description: '采购日期' })
	@IsString()
	@IsOptional()
	purchaseDate?: string;

	@ApiPropertyOptional({ description: '备注' })
	@IsString()
	@IsOptional()
	remark?: string;

	@ApiPropertyOptional({ description: '采购明细（整体替换）' })
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreatePurchaseOrderItemDto)
	@IsOptional()
	items?: CreatePurchaseOrderItemDto[];
}

/** 将查询参数归一化为数字数组（兼容单值与数组两种传参形式） */
function toNumberArray(value: unknown): number[] | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	return (Array.isArray(value) ? value : [value]).map((v) => Number(v));
}

/** 查询采购单 DTO */
export class QueryPurchaseOrderDto extends PaginationParamsDto {
	@ApiPropertyOptional({ description: '采购单号' })
	@IsString()
	@IsOptional()
	purchaseNo?: string;

	@ApiPropertyOptional({ description: '供应商 ID' })
	@IsString()
	@IsOptional()
	supplierId?: string;

	@ApiPropertyOptional({ description: '状态（支持多选）', type: [Number] })
	@Transform(({ value }) => toNumberArray(value))
	@IsArray()
	@IsInt({ each: true })
	@IsOptional()
	status?: number[];

	@ApiPropertyOptional({ description: '退货状态' })
	@IsOptional()
	returnStatus?: number;

	@ApiPropertyOptional({ description: '采购开始日期' })
	@IsString()
	@IsOptional()
	startDate?: string;

	@ApiPropertyOptional({ description: '采购结束日期' })
	@IsString()
	@IsOptional()
	endDate?: string;
}
