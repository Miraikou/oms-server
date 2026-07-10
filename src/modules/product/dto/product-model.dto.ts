import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

export class CreateProductModelDto {
  @ApiProperty({ description: '型号名称' })
  @IsString()
  @IsNotEmpty({ message: '型号名称不能为空' })
  modelName: string;

  @ApiPropertyOptional({ description: '默认采购价' })
  @IsString()
  @IsOptional()
  purchasePrice?: string;

  @ApiPropertyOptional({ description: '默认销售价' })
  @IsString()
  @IsOptional()
  salePrice?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

export class UpdateProductModelDto {
  @ApiPropertyOptional({ description: '型号名称' })
  @IsString()
  @IsOptional()
  modelName?: string;

  @ApiPropertyOptional({ description: '默认采购价' })
  @IsString()
  @IsOptional()
  purchasePrice?: string;

  @ApiPropertyOptional({ description: '默认销售价' })
  @IsString()
  @IsOptional()
  salePrice?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
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
