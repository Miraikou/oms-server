import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsNumberString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSalespersonDto {
  @ApiProperty({ description: '姓名' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  name: string;

  @ApiPropertyOptional({ description: '联系电话' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: '提成比例（%）', default: '40.0000' })
  @IsNumberString({}, { message: '提成比例必须为数字' })
  @IsOptional()
  commissionRate?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

export class UpdateSalespersonDto {
  @ApiPropertyOptional({ description: '姓名' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: '联系电话' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: '提成比例（%）' })
  @IsNumberString({}, { message: '提成比例必须为数字' })
  @IsOptional()
  commissionRate?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}
