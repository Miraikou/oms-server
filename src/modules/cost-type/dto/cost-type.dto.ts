import { IsNotEmpty, IsOptional, IsString, IsIn, IsInt, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto'

export class CreateCostTypeDto {
  @ApiProperty({ description: '成本类型名称' })
  @IsString()
  @IsNotEmpty({ message: '成本类型名称不能为空' })
  costName: string

  @ApiPropertyOptional({ description: '排序号', default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  sortNo?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateCostTypeDto {
  @ApiPropertyOptional({ description: '成本类型名称' })
  @IsString()
  @IsOptional()
  costName?: string

  @ApiPropertyOptional({ description: '排序号' })
  @IsInt()
  @Min(0)
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

export class QueryCostTypeDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number
}
