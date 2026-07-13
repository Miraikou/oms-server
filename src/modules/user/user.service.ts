import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SysUser } from './entities/sys-user.entity';
import { RoleService } from '../role/role.service';
import type {
  CreateUserDto,
  UpdateUserDto,
  QueryUserDto,
} from './dto/user.dto';
import { snowflake } from '@/common/utils/snowflake';

/**
 * 用户服务
 * 提供用户 CRUD、密码管理等核心功能
 */
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(SysUser)
    private readonly userRepo: Repository<SysUser>,
    private readonly roleService: RoleService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 分页查询用户列表
   */
  async findAll(query: QueryUserDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role')
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
        'role.id',
        'role.roleName',
      ]);

    if (query.keyword) {
      qb.andWhere('(user.username LIKE :kw OR user.realName LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }

    if (query.status !== undefined) {
      qb.andWhere('user.status = :status', { status: query.status });
    }

    const sortField = query.sortField || 'createdTime';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`user.${sortField}`, sortOrder)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();

    return { list, total, page, pageSize };
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
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    // 查询用户角色
    const roles = await this.roleService.findUserRoles(id);

    return { ...user, roles };
  }

  /**
   * 创建用户（事务：用户保存 + 角色分配原子执行）
   */
  async create(dto: CreateUserDto) {
    // 检查用户名是否已存在
    const existing = await this.userRepo.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(SysUser, {
        id: snowflake.nextId(),
        username: dto.username,
        password: await bcrypt.hash(dto.password, 10),
        realName: dto.realName,
        phone: dto.phone || null,
        email: dto.email || null,
        status: dto.status ?? 1,
        remark: dto.remark || null,
      });

      const saved = await manager.save(user);

      // 分配角色（roleIds 为空数组时不操作，避免无角色登录）
      if (dto.roleIds && dto.roleIds.length > 0) {
        await this.roleService.assignUserRoles(saved.id, dto.roleIds, manager);
      }

      return {
        id: saved.id,
        username: saved.username,
        realName: saved.realName,
        status: saved.status,
      };
    });
  }

  /**
   * 更新用户（事务：用户保存 + 角色分配原子执行）
   * 传 roleIds: [] 会清除全部角色（有意的安全管理操作）
   */
  async update(id: string, dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.realName !== undefined) user.realName = dto.realName;
      if (dto.phone !== undefined) user.phone = dto.phone === '' ? null : dto.phone;
      if (dto.email !== undefined) user.email = dto.email === '' ? null : dto.email;
      if (dto.status !== undefined) user.status = dto.status;
      if (dto.remark !== undefined) user.remark = dto.remark === '' ? null : dto.remark;

      await manager.save(user);

      // 仅当明确传入 roleIds 时才更新角色
      if (dto.roleIds !== undefined) {
        await this.roleService.assignUserRoles(id, dto.roleIds, manager);
      }

      return { id: user.id, username: user.username, realName: user.realName };
    });
  }

  /**
   * 切换用户状态（启用/停用）
   */
  async toggleStatus(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    user.status = user.status === 1 ? 0 : 1;
    await this.userRepo.save(user);

    return { id: user.id, status: user.status };
  }

  /**
   * 重置用户密码
   */
  async resetPassword(id: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await this.userRepo.save(user);
  }

  /**
   * 创建种子管理员账号（仅当不存在 admin 用户时）
   * 自动分配 SUPER_ADMIN 角色
   */
  async seedAdmin() {
    const admin = await this.userRepo.findOne({ where: { username: 'admin' } });
    if (admin) {
      // 确保 admin 已有 SUPER_ADMIN 角色
      const roles = await this.roleService.findUserRoleCodes(admin.id);
      if (!roles.includes('SUPER_ADMIN')) {
        const superAdminRole = await this.roleService.findAllActive();
        const saRole = superAdminRole.find((r) => r.roleCode === 'SUPER_ADMIN');
        if (saRole) {
          await this.roleService.assignUserRoles(admin.id, [saRole.id]);
        }
      }
      return null;
    }

    const newAdmin = this.userRepo.create({
      id: snowflake.nextId(),
      username: 'admin',
      password: await bcrypt.hash('admin123', 10),
      realName: '超级管理员',
      status: 1,
    });

    const saved = await this.userRepo.save(newAdmin);

    // 分配 SUPER_ADMIN 角色
    const allRoles = await this.roleService.findAllActive();
    const saRole = allRoles.find((r) => r.roleCode === 'SUPER_ADMIN');
    if (saRole) {
      await this.roleService.assignUserRoles(saved.id, [saRole.id]);
    }

    return saved;
  }
}
