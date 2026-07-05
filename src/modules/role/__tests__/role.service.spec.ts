import { ConflictException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { RoleService } from '../role.service'
import { SysRole } from '../entities/sys-role.entity'
import { SysUserRole } from '../entities/sys-user-role.entity'
import { SysRoleMenu } from '../../menu/entities/sys-role-menu.entity'

jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

describe('RoleService', () => {
  let service: RoleService

  const mockRoleRepo = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((d: any) => ({ id: '9999999999999999', ...d })),
    save: jest.fn((e: any) => Promise.resolve(e)),
    remove: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn((): any => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    })),
  }

  const mockUserRoleRepo = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((d: any) => d),
    save: jest.fn().mockResolvedValue(undefined),
  }

  const mockRoleMenuRepo = {
    find: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((d: any) => d),
    save: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
  }

  const mockManager = {
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((_: any, d: any) => d),
    save: jest.fn().mockResolvedValue(undefined),
  }

  const mockDataSource = {
    transaction: jest.fn((cb: Function) => cb(mockManager)),
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getRepositoryToken(SysRole), useValue: mockRoleRepo },
        { provide: getRepositoryToken(SysUserRole), useValue: mockUserRoleRepo },
        { provide: getRepositoryToken(SysRoleMenu), useValue: mockRoleMenuRepo },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<RoleService>(RoleService)
  })

  describe('create', () => {
    it('应成功创建角色', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null)

      const result = await service.create({
        roleName: '测试角色',
        roleCode: 'TEST_ROLE',
      })

      expect(result.roleName).toBe('测试角色')
      expect(mockRoleRepo.save).toHaveBeenCalled()
    })

    it('角色名称重复应抛出 ConflictException', async () => {
      mockRoleRepo.findOne.mockResolvedValue({ roleName: '已存在' })

      await expect(
        service.create({ roleName: '已存在', roleCode: 'TEST' }),
      ).rejects.toThrow(ConflictException)
    })

    it('角色编码重复应抛出 ConflictException', async () => {
      mockRoleRepo.findOne
        .mockResolvedValueOnce(null) // roleName check
        .mockResolvedValueOnce({ roleCode: 'EXISTING' }) // roleCode check

      await expect(
        service.create({ roleName: '新角色', roleCode: 'EXISTING' }),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('update', () => {
    it('应成功更新角色', async () => {
      mockRoleRepo.findOne.mockResolvedValue({
        id: '1', roleName: '旧名称', roleCode: 'OLD', status: 1,
      })
      mockRoleRepo.findOne.mockResolvedValueOnce({
        id: '1', roleName: '旧名称', roleCode: 'OLD', status: 1,
      })
      // For the uniqueness check
      mockRoleRepo.findOne.mockResolvedValueOnce(null)

      const result = await service.update('1', { roleName: '新名称' })

      expect(result.roleName).toBe('新名称')
    })

    it('角色不存在应抛出 NotFoundException', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null)

      await expect(service.update('999', { roleName: 'test' }))
        .rejects.toThrow(NotFoundException)
    })
  })

  describe('delete', () => {
    it('无用户引用时应成功删除', async () => {
      mockRoleRepo.findOne.mockResolvedValue({ id: '1', roleName: 'test' })
      mockUserRoleRepo.count.mockResolvedValue(0)

      await service.delete('1')

      expect(mockRoleMenuRepo.delete).toHaveBeenCalledWith({ roleId: '1' })
      expect(mockRoleRepo.remove).toHaveBeenCalled()
    })

    it('有用户引用时应抛出 ConflictException', async () => {
      mockRoleRepo.findOne.mockResolvedValue({ id: '1', roleName: 'test' })
      mockUserRoleRepo.count.mockResolvedValue(3)

      await expect(service.delete('1')).rejects.toThrow(ConflictException)
    })

    it('角色不存在应抛出 NotFoundException', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null)

      await expect(service.delete('999')).rejects.toThrow(NotFoundException)
    })
  })

  describe('assignMenus', () => {
    it('应在事务中先删后插', async () => {
      mockRoleRepo.findOne.mockResolvedValue({ id: '1', roleName: 'test' })

      await service.assignMenus('1', ['menu-1', 'menu-2'])

      expect(mockDataSource.transaction).toHaveBeenCalled()
      expect(mockManager.delete).toHaveBeenCalledWith(SysRoleMenu, { roleId: '1' })
      expect(mockManager.save).toHaveBeenCalled()
    })

    it('角色不存在应抛出 NotFoundException', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null)

      await expect(service.assignMenus('999', [])).rejects.toThrow(NotFoundException)
    })

    it('空菜单列表应只删除不插入', async () => {
      mockRoleRepo.findOne.mockResolvedValue({ id: '1', roleName: 'test' })

      await service.assignMenus('1', [])

      expect(mockManager.delete).toHaveBeenCalledWith(SysRoleMenu, { roleId: '1' })
    })
  })

  describe('findUserRoleCodes', () => {
    it('应返回用户的角色编码列表', async () => {
      mockUserRoleRepo.find.mockResolvedValue([
        { userId: '1', roleId: 'r1' },
        { userId: '1', roleId: 'r2' },
      ])
      mockRoleRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { roleCode: 'SALES' },
          { roleCode: 'FINANCE' },
        ]),
      } as any)

      const result = await service.findUserRoleCodes('1')

      expect(result).toEqual(['SALES', 'FINANCE'])
    })

    it('无角色时应返回空数组', async () => {
      mockUserRoleRepo.find.mockResolvedValue([])

      const result = await service.findUserRoleCodes('1')

      expect(result).toEqual([])
    })
  })

  describe('seedRoles', () => {
    it('不存在时应创建 6 个默认角色', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null)

      const created = await service.seedRoles()

      expect(created.length).toBe(6)
      expect(mockRoleRepo.save).toHaveBeenCalledTimes(6)
    })

    it('已存在时应跳过', async () => {
      mockRoleRepo.findOne.mockResolvedValue({ roleCode: 'EXISTING' })

      const created = await service.seedRoles()

      expect(created.length).toBe(0)
    })
  })
})
