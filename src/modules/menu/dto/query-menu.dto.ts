import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/** 菜单查询 DTO */
export class QueryMenuDto {
  @ApiProperty({ required: false, description: '关键词搜索' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({ required: false, description: '状态筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  status?: number;
}
