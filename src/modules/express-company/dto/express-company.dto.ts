import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto'

export class CreateExpressCompanyDto {
  @ApiProperty({ description: '快递公司名称' })
  @IsString()
  @IsNotEmpty({ message: '快递公司名称不能为空' })
  companyName: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateExpressCompanyDto {
  @ApiPropertyOptional({ description: '快递公司名称' })
  @IsString()
  @IsOptional()
  companyName?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class QueryExpressCompanyDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number
}
