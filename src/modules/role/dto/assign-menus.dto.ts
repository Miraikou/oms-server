import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** 分配角色菜单权限 DTO */
export class AssignMenusDto {
  @ApiProperty({ description: '菜单 ID 列表', type: [String] })
  @IsArray()
  @IsString({ each: true })
  menuIds: string[];
}
