import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { SysUser } from '../../user/entities/sys-user.entity';
import { SysLoginLog } from '../entities/sys-login-log.entity';
import { RoleService } from '../../role/role.service';
import { MenuService } from '../../menu/menu.service';

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

const bcrypt = require('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;

  const mockUserRepo = {
    findOne: jest.fn(),
    save: jest.fn((u: any) => Promise.resolve(u)),
  };
  const mockLoginLogRepo = {
    create: jest.fn((d: any) => d),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-token'),
    verify: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn((key: string, def: string) => def),
  };
  const mockRoleService = {
    findUserRoleCodes: jest.fn().mockResolvedValue(['SUPER_ADMIN']),
  };
  const mockMenuService = {
    findAll: jest.fn().mockResolvedValue([]),
    findAllPermissions: jest.fn().mockResolvedValue([]),
    findUserPermissions: jest
      .fn()
      .mockResolvedValue({ menus: [], permissions: [] }),
  };

  const testUser = {
    id: '1000000000000001',
    username: 'admin',
    password: '$2a$10$hashed',
    realName: '管理员',
    status: 1,
    lastLoginTime: null,
    lastLoginIp: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    bcrypt.compare.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(SysUser), useValue: mockUserRepo },
        {
          provide: getRepositoryToken(SysLoginLog),
          useValue: mockLoginLogRepo,
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RoleService, useValue: mockRoleService },
        { provide: MenuService, useValue: mockMenuService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('登录成功应返回 token 和用户信息（含角色）', async () => {
      mockUserRepo.findOne.mockResolvedValue(testUser);

      const result = await service.login(
        { username: 'admin', password: 'admin123' },
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(result.accessToken).toBe('mock-token');
      expect(result.refreshToken).toBe('mock-token');
      expect(result.user.username).toBe('admin');
      expect(result.user.roles).toEqual(['SUPER_ADMIN']);
    });

    it('用户不存在应抛出 UnauthorizedException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ username: 'nobody', password: '123' }, '', ''),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('账号停用应抛出 UnauthorizedException', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...testUser, status: 0 });

      await expect(
        service.login({ username: 'admin', password: '123' }, '', ''),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('密码错误应抛出 UnauthorizedException', async () => {
      mockUserRepo.findOne.mockResolvedValue(testUser);
      bcrypt.compare.mockResolvedValue(false);

      await expect(
        service.login({ username: 'admin', password: 'wrong' }, '', ''),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('登录成功应记录登录日志', async () => {
      mockUserRepo.findOne.mockResolvedValue(testUser);

      await service.login(
        { username: 'admin', password: 'admin123' },
        '127.0.0.1',
        'UA',
      );

      expect(mockLoginLogRepo.save).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('应返回用户信息和角色列表', async () => {
      mockUserRepo.findOne.mockResolvedValue(testUser);

      const result = await service.getProfile('1000000000000001');

      expect(result.username).toBe('admin');
      expect(result.roles).toEqual(['SUPER_ADMIN']);
    });

    it('用户不存在应抛出 UnauthorizedException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.getProfile('999')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('refreshToken', () => {
    it('有效 refreshToken 应返回新 accessToken', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: '1000000000000001',
        username: 'admin',
      });
      mockUserRepo.findOne.mockResolvedValue(testUser);

      const result = await service.refreshToken('valid-refresh-token');

      expect(result.accessToken).toBe('mock-token');
    });

    it('无效 refreshToken 应抛出 UnauthorizedException', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      await expect(service.refreshToken('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('用户已停用应抛出 UnauthorizedException', async () => {
      mockJwtService.verify.mockReturnValue({
        sub: '1000000000000001',
        username: 'admin',
      });
      mockUserRepo.findOne.mockResolvedValue({ ...testUser, status: 0 });

      await expect(service.refreshToken('refresh-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('changePassword', () => {
    it('旧密码正确应成功修改', async () => {
      mockUserRepo.findOne.mockResolvedValue(testUser);
      bcrypt.compare.mockResolvedValue(true);
      bcrypt.hash.mockResolvedValue('$2a$10$newhash');

      await service.changePassword('1000000000000001', {
        oldPassword: 'old123',
        newPassword: 'new456',
      });

      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('旧密码错误应抛出 BadRequestException', async () => {
      mockUserRepo.findOne.mockResolvedValue(testUser);
      bcrypt.compare.mockResolvedValue(false);

      await expect(
        service.changePassword('1000000000000001', {
          oldPassword: 'wrong',
          newPassword: 'new456',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUserMenus', () => {
    it('SUPER_ADMIN 应返回全部菜单和权限', async () => {
      mockRoleService.findUserRoleCodes.mockResolvedValue(['SUPER_ADMIN']);
      mockMenuService.findAll.mockResolvedValue([
        { id: '1', menuName: '驾驶舱' },
      ]);
      mockMenuService.findAllPermissions.mockResolvedValue([
        'order:create',
        'order:edit',
      ]);

      const result = await service.getUserMenus('1000000000000001');

      expect(result.menus).toHaveLength(1);
      expect(result.permissions).toContain('order:create');
    });

    it('普通用户应返回按角色过滤的菜单和权限', async () => {
      mockRoleService.findUserRoleCodes.mockResolvedValue(['SALES']);
      mockMenuService.findUserPermissions.mockResolvedValue({
        menus: [{ id: '1', menuName: '订单管理' }],
        permissions: ['order:query', 'order:create'],
      });

      const result = await service.getUserMenus('1000000000000002');

      expect(result.menus).toHaveLength(1);
      expect(result.permissions).toEqual(['order:query', 'order:create']);
    });
  });
});
