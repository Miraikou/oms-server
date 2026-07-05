import { Module, OnModuleInit, Logger } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SysMenu } from './entities/sys-menu.entity'
import { SysRoleMenu } from './entities/sys-role-menu.entity'
import { SysUserRole } from '../role/entities/sys-user-role.entity'
import { MenuController } from './menu.controller'
import { MenuService } from './menu.service'

/**
 * 菜单管理模块
 * 提供菜单 CRUD、树形查询、权限查询等功能
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysMenu, SysRoleMenu, SysUserRole]),
  ],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule implements OnModuleInit {
  private readonly logger = new Logger(MenuModule.name)

  constructor(private readonly menuService: MenuService) {}

  async onModuleInit() {
    const menus = await this.menuService.seedMenus()
    if (menus.length > 0) {
      this.logger.log(`已初始化 ${menus.length} 个默认菜单/按钮`)
    }

    // 菜单种子完成后初始化角色-菜单关联
    await this.menuService.seedRoleMenus()
  }
}
