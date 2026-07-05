import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { SysUser } from '../user/entities/sys-user.entity'
import { SysLoginLog } from './entities/sys-login-log.entity'
import { RoleModule } from '../role/role.module'
import { MenuModule } from '../menu/menu.module'

/**
 * 认证模块
 * 提供 JWT 认证、登录、登出、Token 刷新等功能
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUser, SysLoginLog]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    RoleModule,
    MenuModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'oms-dev-secret'),
        signOptions: {
          expiresIn: parseInt(
            configService.get<string>('JWT_EXPIRES_IN_SECONDS', '7200'), 10,
          ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
