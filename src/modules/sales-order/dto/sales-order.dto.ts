import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsInt,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 订单明细项 DTO */
export class CreateSalesOrderItemDto {
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

  @ApiProperty({ description: '销售单价（订单币种）' })
  @IsString()
  @IsNotEmpty({ message: '销售单价不能为空' })
  unitPrice: string;
}

/** 创建订单成本 DTO */
export class CreateSalesOrderCostDto {
  @ApiProperty({ description: '成本类型 ID' })
  @IsString()
  @IsNotEmpty({ message: '成本类型不能为空' })
  costTypeId: string;

  @ApiProperty({ description: '金额（原币种）' })
  @IsString()
  @IsNotEmpty({ message: '金额不能为空' })
  amount: string;

  @ApiPropertyOptional({ description: '币种，默认 CNY' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

/** 内联收款 DTO（随订单创建一起提交，orderId 从订单获取） */
export class CreatePaymentInlineDto {
  @ApiProperty({ description: '收款金额（订单币种）' })
  @IsString()
  @IsNotEmpty({ message: '收款金额不能为空' })
  amount: string;

  @ApiProperty({ description: '收款日期' })
  @IsString()
  @IsNotEmpty({ message: '收款日期不能为空' })
  paymentDate: string;

  @ApiPropertyOptional({ description: '收款方式' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: '付款方' })
  @IsString()
  @IsOptional()
  payer?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

/** 创建订单 DTO */
export class CreateSalesOrderDto {
  @ApiProperty({ description: '销售员 ID' })
  @IsString()
  @IsNotEmpty({ message: '销售员不能为空' })
  salespersonId: string;

  @ApiProperty({ description: '客户名称' })
  @IsString()
  @IsNotEmpty({ message: '客户名称不能为空' })
  customerName: string;

  @ApiProperty({ description: '下单日期' })
  @IsString()
  @IsNotEmpty({ message: '下单日期不能为空' })
  orderDate: string;

  @ApiProperty({ description: '运输渠道 ID' })
  @IsString()
  @IsNotEmpty({ message: '运输渠道不能为空' })
  transportChannelId: string;

  @ApiProperty({ description: '交易方式' })
  @IsString()
  @IsNotEmpty({ message: '交易方式不能为空' })
  tradeType: string;

  @ApiPropertyOptional({ description: '订单币种（CNY/USD），默认 USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: '汇率（后端自动获取，前端传值将被忽略）' })
  @IsString()
  @IsOptional()
  exchangeRate?: string;

  @ApiPropertyOptional({ description: '博主佣金比例(%)，默认 5' })
  @IsString()
  @IsOptional()
  bloggerCommissionRate?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiProperty({
    description: '商品明细（至少一项）',
    type: [CreateSalesOrderItemDto],
  })
  @IsArray({ message: '商品明细不能为空' })
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderItemDto)
  items: CreateSalesOrderItemDto[];

  @ApiPropertyOptional({ description: '同步收款（可选）', type: CreatePaymentInlineDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreatePaymentInlineDto)
  payment?: CreatePaymentInlineDto;

  @ApiPropertyOptional({ description: '同步成本（可选）', type: [CreateSalesOrderCostDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderCostDto)
  costs?: CreateSalesOrderCostDto[];
}

/** 修改订单 DTO（仅待发货状态可修改） */
export class UpdateSalesOrderDto {
  @ApiPropertyOptional({ description: '销售员 ID' })
  @IsString()
  @IsOptional()
  salespersonId?: string;

  @ApiPropertyOptional({ description: '客户名称' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiPropertyOptional({ description: '下单日期' })
  @IsString()
  @IsOptional()
  orderDate?: string;

  @ApiPropertyOptional({ description: '运输渠道 ID' })
  @IsString()
  @IsOptional()
  transportChannelId?: string;

  @ApiPropertyOptional({ description: '交易方式' })
  @IsString()
  @IsOptional()
  tradeType?: string;

  @ApiPropertyOptional({ description: '订单币种（CNY/USD）' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: '汇率（后端自动获取，前端传值将被忽略）' })
  @IsString()
  @IsOptional()
  exchangeRate?: string;

  @ApiPropertyOptional({ description: '博主佣金比例(%)' })
  @IsString()
  @IsOptional()
  bloggerCommissionRate?: string;

  @ApiPropertyOptional({ description: '备注（传空字符串将置为 null）' })
  @IsString()
  @IsOptional()
  remark?: string | null;

  @ApiPropertyOptional({ description: '商品明细（整体替换）', type: [CreateSalesOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderItemDto)
  @IsOptional()
  items?: CreateSalesOrderItemDto[];

  @ApiPropertyOptional({ description: '同步新增成本（可选）', type: [CreateSalesOrderCostDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderCostDto)
  costs?: CreateSalesOrderCostDto[];
}

/** 订单查询 DTO */
export class QuerySalesOrderDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '订单编号（模糊）' })
  @IsString()
  @IsOptional()
  orderNo?: string;

  @ApiPropertyOptional({ description: '订单状态' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '发货状态' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  shipmentStatus?: number;

  @ApiPropertyOptional({ description: '收款状态' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  paymentStatus?: number;

  @ApiPropertyOptional({ description: '销售员 ID' })
  @IsString()
  @IsOptional()
  salespersonId?: string;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsString()
  @IsOptional()
  endDate?: string;
}

/** 修改订单成本 DTO */
export class UpdateSalesOrderCostDto {
  @ApiPropertyOptional({ description: '成本类型 ID（不可与同订单下已有类型冲突）' })
  @IsString()
  @IsOptional()
  costTypeId?: string;

  @ApiPropertyOptional({ description: '金额（原币种）' })
  @IsString()
  @IsOptional()
  amount?: string;

  @ApiPropertyOptional({ description: '币种（变更时重新查汇率）' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({ description: '备注（传空字符串将置为 null）' })
  @IsString()
  @IsOptional()
  remark?: string | null;
}
