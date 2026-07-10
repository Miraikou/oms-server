import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { SysRole } from './entities/sys-role.entity';
import { SysUserRole } from './entities/sys-user-role.entity';
import { SysRoleMenu } from '../menu/entities/sys-role-menu.entity';
import { snowflake } from '@/common/utils/snowflake';

/** 默认角色种子数据 */
const DEFAULT_ROLES = [
  { roleName: '超级管理员', roleCode: 'SUPER_ADMIN' },
  { roleName: '老板', roleCode: 'BOSS' },
  { roleName: '销售', roleCode: 'SALES' },
  { roleName: '采购', roleCode: 'PURCHASER' },
  { roleName: '仓库', roleCode: 'WAREHOUSE' },
  { roleName: '财务', roleCode: 'FINANCE' },
];

/**
 * 角色管理服务
 * 提供角色 CRUD、菜单权限分配、用户角色查询等功能
 */
@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    @InjectRepository(SysRole)
    private readonly roleRepo: Repository<SysRole>,
    @InjectRepository(SysUserRole)
    private readonly userRoleRepo: Repository<SysUserRole>,
    @InjectRepository(SysRoleMenu)
    private readonly roleMenuRepo: Repository<SysRoleMenu>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 分页查询角色列表
   */
  async findAll(query: {
    keyword?: string;
    status?: number;
    page?: number;
    pageSize?: number;
  }) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.roleRepo.createQueryBuilder('role');

    if (query.keyword) {
      qb.andWhere('(role.roleName LIKE :kw OR role.roleCode LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }

    if (query.status !== undefined) {
      qb.andWhere('role.status = :status', { status: query.status });
    }

    qb.orderBy('role.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  /** 获取全部启用角色（下拉选项用） */
  async findAllActive() {
    return this.roleRepo
      .createQueryBuilder('role')
      .where('role.status = :status', { status: 1 })
      .orderBy('role.createdTime', 'ASC')
      .getMany();
  }

  /**
   * 根据 ID 查询角色详情（含已关联菜单 ID 列表）
   */
  async findOne(id: string) {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    // 查询已关联的菜单 ID
    const roleMenus = await this.roleMenuRepo.find({ where: { roleId: id } });
    const menuIds = roleMenus.map((rm) => rm.menuId);

    return { ...role, menuIds };
  }

  /**
   * 创建角色
   */
  async create(data: {
    roleName: string;
    roleCode: string;
    status?: number;
    remark?: string;
  }) {
    // 检查角色名称唯一性
    const existingName = await this.roleRepo.findOne({
      where: { roleName: data.roleName },
    });
    if (existingName) {
      throw new ConflictException('角色名称已存在');
    }

    // 检查角色编码唯一性
    const existingCode = await this.roleRepo.findOne({
      where: { roleCode: data.roleCode },
    });
    if (existingCode) {
      throw new ConflictException('角色编码已存在');
    }

    const role = this.roleRepo.create({
      id: snowflake.nextId(),
      ...data,
      status: data.status ?? 1,
    });

    return this.roleRepo.save(role);
  }

  /**
   * 更新角色
   */
  async update(
    id: string,
    data: {
      roleName?: string;
      roleCode?: string;
      status?: number;
      remark?: string;
    },
  ) {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    // 检查角色名称唯一性
    if (data.roleName !== undefined && data.roleName !== role.roleName) {
      const existing = await this.roleRepo.findOne({
        where: { roleName: data.roleName },
      });
      if (existing) {
        throw new ConflictException('角色名称已存在');
      }
      role.roleName = data.roleName;
    }

    // 检查角色编码唯一性
    if (data.roleCode !== undefined && data.roleCode !== role.roleCode) {
      const existing = await this.roleRepo.findOne({
        where: { roleCode: data.roleCode },
      });
      if (existing) {
        throw new ConflictException('角色编码已存在');
      }
      role.roleCode = data.roleCode;
    }

    if (data.status !== undefined) role.status = data.status;
    if (data.remark !== undefined) role.remark = data.remark;

    return this.roleRepo.save(role);
  }

  /**
   * 删除角色（已被用户引用的角色禁止删除）
   */
  async delete(id: string) {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    // 检查是否有用户关联
    const userRoleCount = await this.userRoleRepo.count({
      where: { roleId: id },
    });
    if (userRoleCount > 0) {
      throw new ConflictException('该角色已被用户引用，无法删除');
    }

    // 删除角色菜单关联
    await this.roleMenuRepo.delete({ roleId: id });

    // 删除角色
    await this.roleRepo.remove(role);
  }

  /**
   * 分配角色菜单权限（事务：先删后插）
   */
  async assignMenus(roleId: string, menuIds: string[]) {
    const role = await this.roleRepo.findOne({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    await this.dataSource.transaction(async (manager) => {
      // 删除原有关联
      await manager.delete(SysRoleMenu, { roleId });

      // 批量插入新关联
      if (menuIds.length > 0) {
        const roleMenus = menuIds.map((menuId) =>
          manager.create(SysRoleMenu, { roleId, menuId }),
        );
        await manager.save(roleMenus);
      }
    });

    return { roleId, menuIds };
  }

  /**
   * 查询用户的角色列表
   */
  async findUserRoles(userId: string) {
    const userRoles = await this.userRoleRepo.find({ where: { userId } });
    if (userRoles.length === 0) return [];

    const roleIds = userRoles.map((ur) => ur.roleId);
    return this.roleRepo
      .createQueryBuilder('role')
      .where('role.id IN (:...roleIds)', { roleIds })
      .andWhere('role.status = :status', { status: 1 })
      .getMany();
  }

  /**
   * 查询用户角色编码列表（用于 JWT payload）
   */
  async findUserRoleCodes(userId: string): Promise<string[]> {
    const roles = await this.findUserRoles(userId);
    return roles.map((r) => r.roleCode);
  }

  /**
   * 分配用户角色（事务：先删后插）
   */
  async assignUserRoles(userId: string, roleIds: string[], externalManager?: EntityManager) {
    const run = async (mgr: EntityManager) => {
      await mgr.delete(SysUserRole, { userId });

      if (roleIds.length > 0) {
        const userRoles = roleIds.map((roleId) =>
          mgr.create(SysUserRole, { userId, roleId }),
        );
        await mgr.save(userRoles);
      }
    };

    if (externalManager) {
      await run(externalManager);
    } else {
      await this.dataSource.transaction(run);
    }
  }

  /**
   * 初始化默认角色种子数据
   * @returns 创建的角色列表（如果已有则返回空）
   */
  async seedRoles() {
    const created: SysRole[] = [];

    for (const roleData of DEFAULT_ROLES) {
      const existing = await this.roleRepo.findOne({
        where: { roleCode: roleData.roleCode },
      });
      if (!existing) {
        const role = this.roleRepo.create({
          id: snowflake.nextId(),
          ...roleData,
          status: 1,
        });
        const saved = await this.roleRepo.save(role);
        created.push(saved);
        this.logger.log(
          `已创建默认角色: ${roleData.roleName} (${roleData.roleCode})`,
        );
      }
    }

    return created;
  }
}
