import { IsNotEmpty, IsOptional, IsString, IsIn, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

export class CreateProductModelDto {
  @ApiProperty({ description: '型号名称' })
  @IsString()
  @IsNotEmpty({ message: '型号名称不能为空' })
  modelName: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({
    description: '最低库存预警值（留空=使用全局阈值 LOW_STOCK_WARNING，0=库存为0时预警，负数=不预警）',
  })
  @IsNumber()
  @IsOptional()
  minimumStock?: number | null;
}

export class UpdateProductModelDto {
  @ApiPropertyOptional({ description: '型号名称' })
  @IsString()
  @IsOptional()
  modelName?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({
    description: '最低库存预警值（留空=使用全局阈值 LOW_STOCK_WARNING，0=库存为0时预警，负数=不预警）',
  })
  @IsNumber()
  @IsOptional()
  minimumStock?: number | null;
}

export class QueryProductModelDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}
