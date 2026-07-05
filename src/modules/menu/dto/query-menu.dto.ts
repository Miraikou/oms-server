import { IsOptional, IsString, IsNumberString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/** 菜单查询 DTO */
export class QueryMenuDto {
  @ApiProperty({ required: false, description: '关键词搜索' })
  @IsOptional()
  @IsString()
  keyword?: string

  @ApiProperty({ required: false, description: '状态筛选' })
  @IsOptional()
  @IsNumberString()
  status?: number
}
