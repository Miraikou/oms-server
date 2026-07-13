import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 创建收款 DTO */
export class CreatePaymentDto {
  @ApiProperty({ description: '订单 ID' })
  @IsString()
  @IsNotEmpty({ message: '订单不能为空' })
  orderId: string;

  @ApiProperty({ description: '本次收款金额（原币）' })
  @IsString()
  @IsNotEmpty({ message: '收款金额不能为空' })
  amount: string;

  @ApiPropertyOptional({ description: '币种，默认 USD' })
  @IsString()
  @IsOptional()
  currency?: string;

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

/** 收款查询 DTO */
export class QueryPaymentDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '收款单号（模糊）' })
  @IsString()
  @IsOptional()
  paymentNo?: string;

  @ApiPropertyOptional({ description: '订单 ID' })
  @IsString()
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: '类型：1=收款 2=退款' })
  @IsOptional()
  type?: number;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsString()
  @IsOptional()
  endDate?: string;
}

/** 创建退款 DTO */
export class CreateRefundDto {
  @ApiProperty({ description: '订单 ID' })
  @IsString()
  @IsNotEmpty({ message: '订单不能为空' })
  orderId: string;

  @ApiProperty({ description: '退款金额（原币）' })
  @IsString()
  @IsNotEmpty({ message: '退款金额不能为空' })
  amount: string;

  @ApiPropertyOptional({ description: '币种，默认 USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ description: '退款日期' })
  @IsString()
  @IsNotEmpty({ message: '退款日期不能为空' })
  paymentDate: string;

  @ApiPropertyOptional({ description: '退款方式' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ description: '收款方（退给谁）' })
  @IsString()
  @IsOptional()
  payer?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}
