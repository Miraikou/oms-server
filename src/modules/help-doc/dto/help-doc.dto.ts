import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 创建帮助文档 DTO */
export class CreateHelpDocDto {
  @ApiProperty({ description: '文档标题' })
  @IsString()
  @IsNotEmpty({ message: '文档标题不能为空' })
  title: string;

  @ApiProperty({ description: '所属分类' })
  @IsString()
  @IsNotEmpty({ message: '分类不能为空' })
  category: string;

  @ApiProperty({ description: 'Markdown 正文' })
  @IsString()
  @IsNotEmpty({ message: '正文不能为空' })
  content: string;

  @ApiPropertyOptional({
    description: '绑定路由（逗号分隔多个前缀，如 /orders,/orders/detail）',
  })
  @IsString()
  @IsOptional()
  routePath?: string;

  @ApiPropertyOptional({ description: '排序号（升序）', default: 0 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '状态：1=已发布，0=草稿', default: 1 })
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: '状态只能为 0 或 1' })
  @IsOptional()
  status?: number;
}

/** 更新帮助文档 DTO */
export class UpdateHelpDocDto {
  @ApiPropertyOptional({ description: '文档标题' })
  @IsString()
  @IsNotEmpty({ message: '文档标题不能为空' })
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ description: '所属分类' })
  @IsString()
  @IsNotEmpty({ message: '分类不能为空' })
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Markdown 正文' })
  @IsString()
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({ description: '绑定路由（逗号分隔多个前缀）' })
  @IsString()
  @IsOptional()
  routePath?: string;

  @ApiPropertyOptional({ description: '排序号（升序）' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '状态：1=已发布，0=草稿' })
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1], { message: '状态只能为 0 或 1' })
  @IsOptional()
  status?: number;
}

/** 查询帮助文档 DTO */
export class QueryHelpDocDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词（标题模糊）' })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ description: '所属分类' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: '状态：1=已发布，0=草稿' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  status?: number;
}
