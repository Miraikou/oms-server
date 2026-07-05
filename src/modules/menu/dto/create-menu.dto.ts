import { IsString, IsNotEmpty, IsOptional, IsIn, IsInt, MaxLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

/** 创建菜单 DTO */
export class CreateMenuDto {
  @ApiProperty({ description: '父菜单 ID', required: false })
  @IsOptional()
  @IsString()
  parentId?: string

  @ApiProperty({ description: '菜单名称' })
  @IsString()
  @IsNotEmpty({ message: '菜单名称不能为空' })
  @MaxLength(100)
  menuName: string

  @ApiProperty({ description: '菜单类型：0=目录，1=菜单，2=按钮' })
  @IsInt()
  @IsIn([0, 1, 2], { message: '菜单类型只能是 0（目录）、1（菜单）、2（按钮）' })
  menuType: number

  @ApiProperty({ description: '权限标识', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  permission?: string

  @ApiProperty({ description: '前端路由路径', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string

  @ApiProperty({ description: 'React 组件路径', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  component?: string

  @ApiProperty({ description: '图标名称', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string

  @ApiProperty({ description: '排序号', default: 0 })
  @IsOptional()
  @IsInt()
  sortNo?: number

  @ApiProperty({ description: '是否显示', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  visible?: number

  @ApiProperty({ description: '状态', default: 1 })
  @IsOptional()
  @IsIn([0, 1])
  status?: number
}
