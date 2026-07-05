import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto'

export class CreateSupplierDto {
  @ApiProperty({ description: '供应商名称' })
  @IsString()
  @IsNotEmpty({ message: '供应商名称不能为空' })
  supplierName: string

  @ApiPropertyOptional({ description: '联系人' })
  @IsString()
  @IsOptional()
  contactName?: string

  @ApiPropertyOptional({ description: '联系电话' })
  @IsString()
  @IsOptional()
  contactPhone?: string

  @ApiPropertyOptional({ description: '地址' })
  @IsString()
  @IsOptional()
  address?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateSupplierDto {
  @ApiPropertyOptional({ description: '供应商名称' })
  @IsString()
  @IsOptional()
  supplierName?: string

  @ApiPropertyOptional({ description: '联系人' })
  @IsString()
  @IsOptional()
  contactName?: string

  @ApiPropertyOptional({ description: '联系电话' })
  @IsString()
  @IsOptional()
  contactPhone?: string

  @ApiPropertyOptional({ description: '地址' })
  @IsString()
  @IsOptional()
  address?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class QuerySupplierDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number
}
