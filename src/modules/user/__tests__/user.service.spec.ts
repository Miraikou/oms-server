import { ConflictException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { UserService } from '../user.service'
import { SysUser } from '../entities/sys-user.entity'
import { RoleService } from '../../role/role.service'

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn(() => Promise.resolve('hashed-password')),
}))

const bcrypt = require('bcryptjs')

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

// ---- Mock Repositories ----
const mockUserRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn((data: any) => ({ ...data })),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
  createQueryBuilder: jest.fn(),
}

// ---- Mock QueryBuilder (for findAll) ----
const mockQB = {
  select: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
}

// ---- Mock Manager for DataSource.transaction ----
const mockManager = {
  create: jest.fn((_entity: any, data: any) => data),
  save: jest.fn((entity: any) => Promise.resolve(entity)),
}

const mockDataSource = {
  transaction: jest.fn((cb: (m: any) => any) => cb(mockManager)),
}

// ---- Mock RoleService ----
const mockRoleService = {
  findUserRoles: jest.fn().mockResolvedValue([]),
  assignUserRoles: jest.fn(),
  findUserRoleCodes: jest.fn().mockResolvedValue([]),
  findAllActive: jest.fn().mockResolvedValue([]),
}

// ---- Test Data ----
const mockUser = {
  id: '9999999999999999',
  username: 'testuser',
  password: 'hashed-password',
  realName: '测试用户',
  phone: '13800138000',
  email: 'test@example.com',
  status: 1,
  lastLoginTime: null,
  lastLoginIp: null,
  createdTime: new Date('2026-01-01'),
  updatedTime: new Date('2026-01-01'),
  remark: null,
}

describe('UserService', () => {
  let service: UserService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockUserRepo.createQueryBuilder.mockReturnValue(mockQB)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(SysUser), useValue: mockUserRepo },
        { provide: RoleService, useValue: mockRoleService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<UserService>(UserService)
  })

  // ============================================================
  //  findAll
  // ============================================================
  describe('findAll', () => {
    it('应支持关键词和状态筛选', async () => {
      const mockList = [{ ...mockUser }]
      mockQB.getManyAndCount.mockResolvedValue([mockList, 1])

      const result = await service.findAll({
        keyword: '测试',
        status: 1,
        page: 1,
        pageSize: 10,
      } as any)

      expect(result.list).toEqual(mockList)
      expect(result.total).toBe(1)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(10)
      expect(mockQB.andWhere).toHaveBeenCalledWith(
        '(user.username LIKE :kw OR user.realName LIKE :kw)',
        { kw: '%测试%' },
      )
      expect(mockQB.andWhere).toHaveBeenCalledWith('user.status = :status', {
        status: 1,
      })
    })

    it('无查询条件时应使用默认分页', async () => {
      mockQB.getManyAndCount.mockResolvedValue([[], 0])

      const result = await service.findAll({} as any)

      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
      expect(result.total).toBe(0)
    })
  })

  // ============================================================
  //  findOne
  // ============================================================
  describe('findOne', () => {
    it('应返回用户详情（含角色）', async () => {
      const roles = [
        { id: 'role-1', roleName: '管理员', roleCode: 'ADMIN' },
      ]
      mockUserRepo.findOne.mockResolvedValue(mockUser)
      mockRoleService.findUserRoles.mockResolvedValue(roles)

      const result = await service.findOne('9999999999999999')

      expect(result.username).toBe('testuser')
      expect(result.roles).toEqual(roles)
      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { id: '9999999999999999' },
        select: {
          id: true,
          username: true,
          realName: true,
          phone: true,
          email: true,
          status: true,
          lastLoginTime: true,
          lastLoginIp: true,
          createdTime: true,
          updatedTime: true,
          remark: true,
        },
      })
    })

    it('用户不存在时应抛出 NotFoundException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)

      await expect(service.findOne('not-exist')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ============================================================
  //  create
  // ============================================================
  describe('create', () => {
    const createDto = {
      username: 'newuser',
      password: '123456',
      realName: '新用户',
      phone: '13900139000',
      email: 'new@example.com',
      status: 1,
      roleIds: ['role-1', 'role-2'],
    }

    it('应成功创建用户并分配角色', async () => {
      mockUserRepo.findOne.mockResolvedValue(null) // 用户名不重复

      const result = await service.create(createDto)

      expect(mockDataSource.transaction).toHaveBeenCalled()
      expect(bcrypt.hash).toHaveBeenCalledWith('123456', 10)
      expect(mockManager.create).toHaveBeenCalledWith(
        SysUser,
        expect.objectContaining({
          username: 'newuser',
          realName: '新用户',
        }),
      )
      expect(mockRoleService.assignUserRoles).toHaveBeenCalledWith(
        '9999999999999999',
        ['role-1', 'role-2'],
      )
      expect(result.username).toBe('newuser')
    })

    it('未传入角色时应创建用户但不分配角色', async () => {
      const dtoWithoutRoles = { ...createDto, roleIds: undefined }
      mockUserRepo.findOne.mockResolvedValue(null)

      const result = await service.create(dtoWithoutRoles)

      expect(mockRoleService.assignUserRoles).not.toHaveBeenCalled()
      expect(result.username).toBe('newuser')
    })

    it('用户名重复时应抛出 ConflictException', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser) // 用户名已存在

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      )
      // 不应进入事务
      expect(mockDataSource.transaction).not.toHaveBeenCalled()
    })
  })

  // ============================================================
  //  update
  // ============================================================
  describe('update', () => {
    it('应成功更新用户信息并重新分配角色', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...mockUser })

      await service.update('9999999999999999', {
        realName: '新名字',
        roleIds: ['role-1'],
      })

      expect(mockDataSource.transaction).toHaveBeenCalled()
      expect(mockRoleService.assignUserRoles).toHaveBeenCalledWith(
        '9999999999999999',
        ['role-1'],
      )
      // 应更新 realName
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ realName: '新名字' }),
      )
    })

    it('roleIds 为空数组时应清除用户全部角色', async () => {
      const userWithRoles = { ...mockUser }
      mockUserRepo.findOne.mockResolvedValue(userWithRoles)

      await service.update('9999999999999999', {
        realName: '新名字',
        roleIds: [],
      })

      // roleIds !== undefined 时，即使为空数组也应调用 assignUserRoles
      expect(mockRoleService.assignUserRoles).toHaveBeenCalledWith(
        '9999999999999999',
        [],
      )
    })

    it('用户不存在时应抛出 NotFoundException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)

      await expect(
        service.update('not-exist', { realName: '新名字' }),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ============================================================
  //  toggleStatus
  // ============================================================
  describe('toggleStatus', () => {
    it('应正确切换用户状态（1 -> 0）', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...mockUser, status: 1 })

      const result = await service.toggleStatus('9999999999999999')

      expect(result.status).toBe(0)
      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 0 }),
      )
    })

    it('用户不存在时应抛出 NotFoundException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)

      await expect(service.toggleStatus('not-exist')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ============================================================
  //  resetPassword
  // ============================================================
  describe('resetPassword', () => {
    it('应成功重设密码（加密后保存）', async () => {
      mockUserRepo.findOne.mockResolvedValue({ ...mockUser })

      await service.resetPassword('9999999999999999', 'newpass123')

      expect(bcrypt.hash).toHaveBeenCalledWith('newpass123', 10)
      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'hashed-password' }),
      )
    })

    it('用户不存在时应抛出 NotFoundException', async () => {
      mockUserRepo.findOne.mockResolvedValue(null)

      await expect(
        service.resetPassword('not-exist', 'newpass123'),
      ).rejects.toThrow(NotFoundException)
    })
  })

  // ============================================================
  //  seedAdmin
  // ============================================================
  describe('seedAdmin', () => {
    it('admin 不存在时应创建并分配 SUPER_ADMIN 角色', async () => {
      mockUserRepo.findOne.mockResolvedValue(null) // admin 不存在
      const saRole = { id: 'sa-role', roleCode: 'SUPER_ADMIN' }
      mockRoleService.findAllActive.mockResolvedValue([saRole])

      const result = await service.seedAdmin()

      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'admin',
          realName: '超级管理员',
        }),
      )
      expect(bcrypt.hash).toHaveBeenCalledWith('admin123', 10)
      expect(mockRoleService.assignUserRoles).toHaveBeenCalledWith(
        '9999999999999999',
        ['sa-role'],
      )
      expect(result).not.toBeNull()
      expect(result!.username).toBe('admin')
    })

    it('admin 已存在且已有 SUPER_ADMIN 角色时应跳过', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser) // admin 已存在
      mockRoleService.findUserRoleCodes.mockResolvedValue(['SUPER_ADMIN'])

      const result = await service.seedAdmin()

      expect(result).toBeNull()
      // 不应创建新用户
      expect(mockUserRepo.create).not.toHaveBeenCalled()
    })

    it('admin 已存在但缺少 SUPER_ADMIN 角色时应自动补全', async () => {
      mockUserRepo.findOne.mockResolvedValue(mockUser)
      mockRoleService.findUserRoleCodes.mockResolvedValue(['USER']) // 无 SUPER_ADMIN
      const saRole = { id: 'sa-role', roleCode: 'SUPER_ADMIN' }
      mockRoleService.findAllActive.mockResolvedValue([saRole])

      const result = await service.seedAdmin()

      expect(result).toBeNull()
      expect(mockRoleService.assignUserRoles).toHaveBeenCalledWith(
        mockUser.id,
        ['sa-role'],
      )
    })
  })
})
