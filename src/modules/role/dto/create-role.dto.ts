import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 创建角色 DTO */
export class CreateRoleDto {
  @ApiProperty({ description: '角色名称' })
  @IsString()
  @IsNotEmpty({ message: '角色名称不能为空' })
  @MaxLength(50)
  roleName: string;

  @ApiProperty({ description: '角色编码' })
  @IsString()
  @IsNotEmpty({ message: '角色编码不能为空' })
  @MaxLength(50)
  roleCode: string;

  @ApiProperty({ description: '状态', default: 1 })
  @IsOptional()
  @IsIn([0, 1], { message: '状态值只能是 0 或 1' })
  status?: number;

  @ApiProperty({ description: '备注', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
