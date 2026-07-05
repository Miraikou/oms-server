import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysRole } from './entities/sys-role.entity';
import { SysUserRole } from './entities/sys-user-role.entity';
import { SysRoleMenu } from '../menu/entities/sys-role-menu.entity';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

/**
 * 角色管理模块
 * 提供角色 CRUD、菜单权限分配、用户角色管理等功能
 */
@Module({
  imports: [TypeOrmModule.forFeature([SysRole, SysUserRole, SysRoleMenu])],
  controllers: [RoleController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule implements OnModuleInit {
  private readonly logger = new Logger(RoleModule.name);

  constructor(private readonly roleService: RoleService) {}

  async onModuleInit() {
    const roles = await this.roleService.seedRoles();
    if (roles.length > 0) {
      this.logger.log(`已初始化 ${roles.length} 个默认角色`);
    }
  }
}
