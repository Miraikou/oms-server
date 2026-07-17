import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  MinLength,
  IsIn,
  IsEmail,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto';

/** 创建用户 DTO */
export class CreateUserDto {
  @ApiProperty({ description: '用户名', example: 'zhangsan' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @ApiProperty({ description: '密码', example: '123456' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;

  @ApiProperty({ description: '姓名', example: '张三' })
  @IsString()
  @IsNotEmpty({ message: '姓名不能为空' })
  realName: string;

  @ApiPropertyOptional({ description: '手机号' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: '状态：1=启用，0=停用', default: 1 })
  @IsIn([0, 1], { message: '状态值只能为 0 或 1' })
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ description: '角色 ID 列表', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roleIds?: string[];
}

/** 更新用户 DTO */
export class UpdateUserDto {
  @ApiPropertyOptional({ description: '姓名' })
  @IsString()
  @IsOptional()
  realName?: string;

  @ApiPropertyOptional({ description: '手机号' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: '状态：1=启用，0=停用' })
  @IsIn([0, 1], { message: '状态值只能为 0 或 1' })
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string;

  @ApiPropertyOptional({ description: '角色 ID 列表', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roleIds?: string[];
}

/** 用户查询 DTO */
export class QueryUserDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词（用户名/姓名）' })
  @IsString()
  @IsOptional()
  keyword?: string;

  @ApiPropertyOptional({ description: '状态筛选' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number;

  @ApiPropertyOptional({ description: '角色编码筛选' })
  @IsString()
  @IsOptional()
  roleCode?: string;
}

/** 重置密码 DTO */
export class ResetPasswordDto {
  @ApiProperty({ description: '新密码', example: '123456' })
  @IsString()
  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(6, { message: '新密码至少 6 位' })
  newPassword: string;
}
