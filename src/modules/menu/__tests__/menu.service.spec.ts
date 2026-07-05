import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MenuService } from '../menu.service';
import { SysMenu } from '../entities/sys-menu.entity';
import { SysRoleMenu } from '../entities/sys-role-menu.entity';
import { SysUserRole } from '../../role/entities/sys-user-role.entity';

jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}));

describe('MenuService', () => {
  let service: MenuService;

  const mockMenuRepo = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((d: any) => ({ id: '9999999999999999', ...d })),
    save: jest.fn((e: any) => Promise.resolve(e)),
    remove: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn((): any => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
    manager: {
      getRepository: jest
        .fn()
        .mockReturnValue({ find: jest.fn().mockResolvedValue([]) }),
    },
  };

  const mockRoleMenuRepo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((d: any) => d),
    save: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };

  const mockUserRoleRepo = {
    find: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MenuService,
        { provide: getRepositoryToken(SysMenu), useValue: mockMenuRepo },
        {
          provide: getRepositoryToken(SysRoleMenu),
          useValue: mockRoleMenuRepo,
        },
        {
          provide: getRepositoryToken(SysUserRole),
          useValue: mockUserRoleRepo,
        },
      ],
    }).compile();

    service = module.get<MenuService>(MenuService);
  });

  describe('findAll', () => {
    it('应返回不含按钮的菜单树', async () => {
      const menus = [
        {
          id: '1',
          parentId: null,
          menuName: '系统管理',
          menuType: 0,
          sortNo: 1,
          status: 1,
          createdTime: new Date(),
        },
        {
          id: '2',
          parentId: '1',
          menuName: '用户管理',
          menuType: 1,
          sortNo: 1,
          status: 1,
          createdTime: new Date(),
        },
      ];

      mockMenuRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(menus),
      });

      const result = await service.findAll();

      expect(result).toHaveLength(1); // 1 个根节点
      expect(result[0].children).toHaveLength(1); // 1 个子节点
    });

    it('空菜单应返回空数组', async () => {
      mockMenuRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('应返回菜单详情', async () => {
      const menu = { id: '1', menuName: '测试', menuType: 1 };
      mockMenuRepo.findOne.mockResolvedValue(menu);

      const result = await service.findOne('1');

      expect(result.menuName).toBe('测试');
    });

    it('菜单不存在应抛出 NotFoundException', async () => {
      mockMenuRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('应成功创建菜单', async () => {
      const result = await service.create({
        menuName: '新菜单',
        menuType: 1,
        path: '/test',
      });

      expect(result.menuName).toBe('新菜单');
      expect(mockMenuRepo.save).toHaveBeenCalled();
    });

    it('创建按钮类型菜单应保存 permission', async () => {
      const result = await service.create({
        menuName: '新增',
        menuType: 2,
        permission: 'order:create',
      });

      expect(result.permission).toBe('order:create');
      expect(result.menuType).toBe(2);
    });
  });

  describe('update', () => {
    it('应成功更新菜单', async () => {
      mockMenuRepo.findOne.mockResolvedValue({
        id: '1',
        menuName: '旧名称',
        menuType: 1,
        parentId: null,
        permission: null,
        path: '/old',
        component: null,
        icon: null,
        sortNo: 1,
        visible: 1,
        status: 1,
      });

      const result = await service.update('1', { menuName: '新名称' });

      expect(result.menuName).toBe('新名称');
    });

    it('菜单不存在应抛出 NotFoundException', async () => {
      mockMenuRepo.findOne.mockResolvedValue(null);

      await expect(service.update('999', { menuName: 'test' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('无子菜单且无角色引用时应成功删除', async () => {
      mockMenuRepo.findOne.mockResolvedValue({ id: '1', menuName: 'test' });
      mockMenuRepo.count.mockResolvedValue(0);
      mockRoleMenuRepo.count.mockResolvedValue(0);

      await service.delete('1');

      expect(mockMenuRepo.remove).toHaveBeenCalled();
    });

    it('有子菜单时应抛出 ConflictException', async () => {
      mockMenuRepo.findOne.mockResolvedValue({ id: '1', menuName: 'test' });
      mockMenuRepo.count.mockResolvedValue(2); // 有 2 个子菜单

      await expect(service.delete('1')).rejects.toThrow(ConflictException);
    });

    it('有角色引用时应抛出 ConflictException', async () => {
      mockMenuRepo.findOne.mockResolvedValue({ id: '1', menuName: 'test' });
      mockMenuRepo.count.mockResolvedValue(0); // 无子菜单
      mockRoleMenuRepo.count.mockResolvedValue(3); // 但被 3 个角色引用

      await expect(service.delete('1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findUserPermissions', () => {
    it('无角色用户应返回空菜单和空权限', async () => {
      mockUserRoleRepo.find.mockResolvedValue([]);

      const result = await service.findUserPermissions('user-1');

      expect(result.menus).toEqual([]);
      expect(result.permissions).toEqual([]);
    });

    it('应返回用户有权限的菜单树和按钮权限列表', async () => {
      // 用户有 1 个角色
      mockUserRoleRepo.find.mockResolvedValue([{ userId: 'u1', roleId: 'r1' }]);

      // 角色关联 3 个菜单（1 目录 + 1 菜单 + 1 按钮）
      mockRoleMenuRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { roleId: 'r1', menuId: 'dir-1' },
          { roleId: 'r1', menuId: 'menu-1' },
          { roleId: 'r1', menuId: 'btn-1' },
        ]),
      });

      // 菜单列表
      mockMenuRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'dir-1',
            parentId: null,
            menuName: '订单管理',
            menuType: 0,
            sortNo: 1,
            status: 1,
            visible: 1,
            permission: null,
          },
          {
            id: 'menu-1',
            parentId: 'dir-1',
            menuName: '订单列表',
            menuType: 1,
            sortNo: 1,
            status: 1,
            visible: 1,
            path: '/orders',
            permission: null,
          },
          {
            id: 'btn-1',
            parentId: 'menu-1',
            menuName: '新增',
            menuType: 2,
            sortNo: 1,
            status: 1,
            visible: 1,
            permission: 'order:create',
          },
        ]),
      });

      const result = await service.findUserPermissions('u1');

      // 菜单树不含按钮
      expect(result.menus).toHaveLength(1);
      expect(result.menus[0].children).toHaveLength(1);

      // 权限列表仅含按钮
      expect(result.permissions).toEqual(['order:create']);
    });
  });

  describe('findAllPermissions', () => {
    it('应返回所有按钮权限标识', async () => {
      mockMenuRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([
            { permission: 'order:create' },
            { permission: 'order:edit' },
            { permission: 'order:delete' },
          ]),
      } as any);

      const result = await service.findAllPermissions();

      expect(result).toEqual(['order:create', 'order:edit', 'order:delete']);
    });
  });
});
