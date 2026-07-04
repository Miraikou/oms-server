import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateCategoryDto {
  @ApiProperty({ description: '分类名称' })
  @IsString()
  @IsNotEmpty({ message: '分类名称不能为空' })
  categoryName: string

  @ApiPropertyOptional({ description: '父分类 ID，0=顶级', default: '0' })
  @IsString()
  @IsOptional()
  parentId?: string

  @ApiPropertyOptional({ description: '排序号', default: 0 })
  @IsOptional()
  sortNo?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: '分类名称' })
  @IsString()
  @IsOptional()
  categoryName?: string

  @ApiPropertyOptional({ description: '父分类 ID' })
  @IsString()
  @IsOptional()
  parentId?: string

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
