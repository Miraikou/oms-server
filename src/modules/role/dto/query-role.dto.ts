import { IsOptional, IsString, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 角色查询 DTO */
export class QueryRoleDto extends PaginationParamsDto {
  @ApiProperty({ required: false, description: '关键词搜索' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiProperty({ required: false, description: '状态筛选' })
  @IsOptional()
  @IsNumberString()
  status?: number;
}
