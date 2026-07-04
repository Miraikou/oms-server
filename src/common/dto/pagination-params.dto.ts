import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator'

/**
 * 分页查询参数 DTO
 * 用于所有分页接口的 Query 参数校验
 */
export class PaginationParamsDto {
  @ApiProperty({ description: '页码', default: 1, minimum: 1, required: false })
  @Type(() => Number)
  @IsInt({ message: '页码必须为整数' })
  @Min(1, { message: '页码最小为 1' })
  @IsOptional()
  page: number = 1

  @ApiProperty({ description: '每页条数', default: 20, minimum: 1, maximum: 200, required: false })
  @Type(() => Number)
  @IsInt({ message: '每页条数必须为整数' })
  @Min(1, { message: '每页条数最小为 1' })
  @Max(200, { message: '每页条数最大为 200' })
  @IsOptional()
  pageSize: number = 20

  @ApiProperty({ description: '排序字段', default: 'createdTime', required: false })
  @IsString()
  @IsOptional()
  sortField: string = 'createdTime'

  @ApiProperty({ description: '排序方向', enum: ['ASC', 'DESC'], default: 'DESC', required: false })
  @IsString()
  @IsOptional()
  sortOrder: 'ASC' | 'DESC' = 'DESC'
}
