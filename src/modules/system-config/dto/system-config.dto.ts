import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSystemConfigDto {
  @ApiProperty({ description: '参数键' })
  @IsString()
  @IsNotEmpty({ message: '参数键不能为空' })
  configKey: string;

  @ApiProperty({ description: '参数值' })
  @IsString()
  @IsNotEmpty({ message: '参数值不能为空' })
  configValue: string;

  @ApiProperty({ description: '参数名称' })
  @IsString()
  @IsNotEmpty({ message: '参数名称不能为空' })
  configName: string;

  @ApiPropertyOptional({
    description: '值类型',
    enum: ['STRING', 'NUMBER', 'BOOLEAN', 'JSON'],
    default: 'STRING',
  })
  @IsIn(['STRING', 'NUMBER', 'BOOLEAN', 'JSON'])
  @IsOptional()
  valueType?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

export class UpdateSystemConfigDto {
  @ApiPropertyOptional({ description: '参数值' })
  @IsString()
  @IsOptional()
  configValue?: string;

  @ApiPropertyOptional({ description: '参数名称' })
  @IsString()
  @IsOptional()
  configName?: string;

  @ApiPropertyOptional({ description: '值类型' })
  @IsIn(['STRING', 'NUMBER', 'BOOLEAN', 'JSON'])
  @IsOptional()
  valueType?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}
