import { IsNotEmpty, IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

// ==================== 字典类型 DTO ====================

export class CreateDictTypeDto {
  @ApiProperty({ description: '字典编码（如 ORDER_STATUS）' })
  @IsString()
  @IsNotEmpty({ message: '字典编码不能为空' })
  typeCode: string;

  @ApiProperty({ description: '字典名称' })
  @IsString()
  @IsNotEmpty({ message: '字典名称不能为空' })
  typeName: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

export class UpdateDictTypeDto {
  @ApiPropertyOptional({ description: '字典名称' })
  @IsString()
  @IsOptional()
  typeName?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

export class QueryDictTypeDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词（编码/名称）' })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}

// ==================== 字典项 DTO ====================

export class CreateDictItemDto {
  @ApiProperty({ description: '所属字典编码' })
  @IsString()
  @IsNotEmpty({ message: '字典编码不能为空' })
  typeCode: string;

  @ApiProperty({ description: '字典值' })
  @IsString()
  @IsNotEmpty({ message: '字典值不能为空' })
  itemValue: string;

  @ApiProperty({ description: '字典标签（显示文本）' })
  @IsString()
  @IsNotEmpty({ message: '字典标签不能为空' })
  itemLabel: string;

  @ApiPropertyOptional({ description: '排序号', default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

export class UpdateDictItemDto {
  @ApiPropertyOptional({ description: '字典值' })
  @IsString()
  @IsOptional()
  itemValue?: string;

  @ApiPropertyOptional({ description: '字典标签（显示文本）' })
  @IsString()
  @IsOptional()
  itemLabel?: string;

  @ApiPropertyOptional({ description: '排序号' })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;
}

export class QueryDictItemDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '字典编码' })
  @IsString()
  @IsOptional()
  typeCode?: string;

  @ApiPropertyOptional({ description: '关键词（标签）' })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;
}
