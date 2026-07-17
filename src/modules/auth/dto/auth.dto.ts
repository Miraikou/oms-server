import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEmail,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @ApiProperty({ description: '密码', example: '123456' })
  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: '刷新令牌' })
  @IsString()
  @IsNotEmpty({ message: '刷新令牌不能为空' })
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: '旧密码' })
  @IsString()
  @IsNotEmpty({ message: '旧密码不能为空' })
  oldPassword: string;

  @ApiProperty({ description: '新密码' })
  @IsString()
  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(6, { message: '新密码至少 6 位' })
  newPassword: string;
}

export class UpdateProfileDto {
  @ApiProperty({ description: '姓名', required: false })
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: '姓名不能为空' })
  realName?: string;

  @ApiProperty({ description: '手机号', required: false })
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: '手机号不能为空' })
  phone?: string;

  @ApiProperty({ description: '邮箱', required: false })
  @IsString()
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}
