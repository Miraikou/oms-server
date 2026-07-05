import { Module, OnModuleInit, Logger } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SysUser } from './entities/sys-user.entity'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { RoleModule } from '../role/role.module'

/**
 * 用户模块
 * 提供用户 CRUD 管理功能
 * 模块初始化时自动创建默认管理员账号并分配 SUPER_ADMIN 角色
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUser]),
    RoleModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule implements OnModuleInit {
  private readonly logger = new Logger(UserModule.name)

  constructor(private readonly userService: UserService) {}

  async onModuleInit() {
    const admin = await this.userService.seedAdmin()
    if (admin) {
      this.logger.log('已创建默认管理员账号: admin / admin123')
    }
  }
}
