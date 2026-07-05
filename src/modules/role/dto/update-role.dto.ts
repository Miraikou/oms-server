import { PartialType } from '@nestjs/swagger';
import { CreateRoleDto } from './create-role.dto';

/** 更新角色 DTO（所有字段可选） */
export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
