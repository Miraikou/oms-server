import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { ConfigService } from '@nestjs/config';
import { SysUser } from '../user/entities/sys-user.entity';
import { SysLoginLog } from './entities/sys-login-log.entity';
import { RoleService } from '../role/role.service';
import { MenuService } from '../menu/menu.service';
import type { LoginDto, ChangePasswordDto } from './dto/auth.dto';
import { snowflake } from '../../common/utils/snowflake';

/** JWT Payload 结构 */
interface JwtPayload {
  sub: string;
  username: string;
}

/**
 * 认证服务
 * 处理登录、Token 生成/刷新、密码修改等核心认证逻辑
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(SysUser)
    private readonly userRepo: Repository<SysUser>,
    @InjectRepository(SysLoginLog)
    private readonly loginLogRepo: Repository<SysLoginLog>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly roleService: RoleService,
    private readonly menuService: MenuService,
  ) {}

  /**
   * 用户登录
   * @param dto 登录参数
   * @param ip 客户端 IP
   * @param userAgent 浏览器 User-Agent
   * @returns accessToken + refreshToken + 用户信息
   */
  async login(dto: LoginDto, ip: string, userAgent: string) {
    const user = await this.userRepo.findOne({
      where: { username: dto.username },
    });

    // 用户不存在 或 已停用
    if (!user || user.status !== 1) {
      await this.recordLoginLog(null, dto.username, ip, userAgent, 0);
      throw new UnauthorizedException('用户不存在或已停用');
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      await this.recordLoginLog(user.id, dto.username, ip, userAgent, 0);
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 更新最后登录信息
    user.lastLoginTime = new Date();
    user.lastLoginIp = ip;
    await this.userRepo.save(user);

    // 记录成功日志
    await this.recordLoginLog(user.id, dto.username, ip, userAgent, 1);

    // 生成 Token
    const payload: JwtPayload = { sub: user.id, username: user.username };
    const accessToken = this.generateAccessToken(payload);
    const refreshToken = this.generateRefreshToken(payload);

    this.logger.log(`用户 ${user.username} 登录成功`);

    // 查询用户角色
    const roles = await this.roleService.findUserRoleCodes(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        realName: user.realName,
        roles,
      },
    };
  }

  /**
   * 刷新访问令牌
   * @param refreshToken 刷新令牌
   * @returns 新的 accessToken
   */
  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.getRefreshSecret(),
      });

      // 验证用户是否仍然有效
      const user = await this.userRepo.findOne({ where: { id: payload.sub } });
      if (!user || user.status !== 1) {
        throw new UnauthorizedException('用户已被禁用');
      }

      const newPayload: JwtPayload = { sub: user.id, username: user.username };
      const accessToken = this.generateAccessToken(newPayload);

      return { accessToken };
    } catch {
      throw new UnauthorizedException('刷新令牌已过期或无效');
    }
  }

  /**
   * 修改密码
   * @param userId 当前用户 ID
   * @param dto 修改密码参数
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const isOldPasswordValid = await bcrypt.compare(
      dto.oldPassword,
      user.password,
    );
    if (!isOldPasswordValid) {
      throw new BadRequestException('旧密码错误');
    }

    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepo.save(user);

    this.logger.log(`用户 ${user.username} 修改密码成功`);
  }

  /**
   * 获取当前登录用户信息
   * @param userId 用户 ID（从 JWT 中提取）
   */
  async getProfile(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, username: true, realName: true },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const roles = await this.roleService.findUserRoleCodes(userId);

    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      roles,
    };
  }

  /**
   * 获取当前用户的菜单树和权限标识列表
   * @param userId 用户 ID
   */
  async getUserMenus(userId: string) {
    // 检查是否有 SUPER_ADMIN 角色，直接返回全部菜单
    const roleCodes = await this.roleService.findUserRoleCodes(userId);
    if (roleCodes.includes('SUPER_ADMIN')) {
      const menus = await this.menuService.findAll();
      const permissions = await this.menuService.findAllPermissions();
      return { menus, permissions };
    }

    return this.menuService.findUserPermissions(userId);
  }

  /**
   * 生成访问令牌（短期有效）
   */
  private generateAccessToken(payload: JwtPayload): string {
    const expiresIn = parseInt(
      this.configService.get<string>('JWT_EXPIRES_IN_SECONDS', '7200'),
      10,
    );
    return this.jwtService.sign(payload, { expiresIn });
  }

  /**
   * 生成刷新令牌（长期有效）
   */
  private generateRefreshToken(payload: JwtPayload): string {
    const expiresIn = parseInt(
      this.configService.get<string>(
        'JWT_REFRESH_EXPIRES_IN_SECONDS',
        '604800',
      ),
      10,
    );
    return this.jwtService.sign(payload, {
      secret: this.getRefreshSecret(),
      expiresIn,
    });
  }

  /**
   * 获取 JWT 刷新密钥，生产环境必须配置环境变量
   */
  private getRefreshSecret(): string {
    const secret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET 环境变量未配置');
    }
    return secret;
  }

  /**
   * 记录登录日志
   */
  private async recordLoginLog(
    userId: string | null,
    username: string,
    ip: string,
    userAgent: string,
    result: number,
  ) {
    try {
      const log = this.loginLogRepo.create({
        id: snowflake.nextId(),
        userId,
        username,
        loginIp: ip,
        userAgent: userAgent.substring(0, 500),
        loginResult: result,
        loginTime: new Date(),
      });
      await this.loginLogRepo.save(log);
    } catch (error) {
      this.logger.error(
        '记录登录日志失败',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
