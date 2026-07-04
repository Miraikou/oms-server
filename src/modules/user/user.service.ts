import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { SysUser } from './entities/sys-user.entity'
import type { CreateUserDto, UpdateUserDto, QueryUserDto } from './dto/user.dto'
import { snowflake } from '@/common/utils/snowflake'

/**
 * 用户服务
 * 提供用户 CRUD、密码管理等核心功能
 */
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(SysUser)
    private readonly userRepo: Repository<SysUser>,
  ) {}

  /**
   * 分页查询用户列表
   */
  async findAll(query: QueryUserDto) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const qb = this.userRepo.createQueryBuilder('user')
      .select([
        'user.id',
        'user.username',
        'user.realName',
        'user.phone',
        'user.email',
        'user.status',
        'user.lastLoginTime',
        'user.lastLoginIp',
        'user.createdTime',
        'user.updatedTime',
        'user.remark',
      ])

    if (query.keyword) {
      qb.andWhere(
        '(user.username LIKE :kw OR user.realName LIKE :kw)',
        { kw: `%${query.keyword}%` },
      )
    }

    if (query.status !== undefined) {
      qb.andWhere('user.status = :status', { status: query.status })
    }

    qb.orderBy('user.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()

    return { list, total, page, pageSize }
  }

  /**
   * 根据 ID 查询用户详情
   */
  async findOne(id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
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

    if (!user) {
      throw new NotFoundException('用户不存在')
    }

    return user
  }

  /**
   * 创建用户
   */
  async create(dto: CreateUserDto) {
    // 检查用户名是否已存在
    const existing = await this.userRepo.findOne({
      where: { username: dto.username },
    })
    if (existing) {
      throw new ConflictException('用户名已存在')
    }

    const user = this.userRepo.create({
      id: snowflake.nextId(),
      username: dto.username,
      password: await bcrypt.hash(dto.password, 10),
      realName: dto.realName,
      phone: dto.phone || null,
      email: dto.email || null,
      status: dto.status ?? 1,
      remark: dto.remark || null,
    })

    const saved = await this.userRepo.save(user)

    return {
      id: saved.id,
      username: saved.username,
      realName: saved.realName,
      status: saved.status,
    }
  }

  /**
   * 更新用户
   */
  async update(id: string, dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }

    if (dto.realName !== undefined) user.realName = dto.realName
    if (dto.phone !== undefined) user.phone = dto.phone
    if (dto.email !== undefined) user.email = dto.email
    if (dto.status !== undefined) user.status = dto.status
    if (dto.remark !== undefined) user.remark = dto.remark

    await this.userRepo.save(user)

    return { id: user.id, username: user.username, realName: user.realName }
  }

  /**
   * 切换用户状态（启用/停用）
   */
  async toggleStatus(id: string) {
    const user = await this.userRepo.findOne({ where: { id } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }

    user.status = user.status === 1 ? 0 : 1
    await this.userRepo.save(user)

    return { id: user.id, status: user.status }
  }

  /**
   * 重置用户密码
   */
  async resetPassword(id: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id } })
    if (!user) {
      throw new NotFoundException('用户不存在')
    }

    user.password = await bcrypt.hash(newPassword, 10)
    await this.userRepo.save(user)
  }

  /**
   * 创建种子管理员账号（仅当不存在 admin 用户时）
   */
  async seedAdmin() {
    const admin = await this.userRepo.findOne({ where: { username: 'admin' } })
    if (admin) return null

    const newAdmin = this.userRepo.create({
      id: snowflake.nextId(),
      username: 'admin',
      password: await bcrypt.hash('admin123', 10),
      realName: '超级管理员',
      status: 1,
    })

    return this.userRepo.save(newAdmin)
  }
}
