import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/** 通用名称类 DTO（适用于快递公司/运输渠道/成本类型等简单模块） */
export class CreateNameDto {
  @ApiProperty({ description: '名称' })
  @IsString()
  @IsNotEmpty({ message: '名称不能为空' })
  name: string

  @ApiPropertyOptional({ description: '排序号', default: 0 })
  @IsOptional()
  sortNo?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateNameDto {
  @ApiPropertyOptional({ description: '名称' })
  @IsString()
  @IsOptional()
  name?: string

  @ApiPropertyOptional({ description: '排序号' })
  @IsOptional()
  sortNo?: number

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class QueryNameDto {
  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number

  @ApiPropertyOptional()
  @IsOptional()
  page?: number

  @ApiPropertyOptional()
  @IsOptional()
  pageSize?: number
}
