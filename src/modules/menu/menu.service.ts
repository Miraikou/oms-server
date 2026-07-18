import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SysMenu } from './entities/sys-menu.entity';
import { SysRoleMenu } from './entities/sys-role-menu.entity';
import { SysUserRole } from '../role/entities/sys-user-role.entity';
import { snowflake } from '@/common/utils/snowflake';

/** 菜单树形节点 */
export interface MenuTreeNode extends SysMenu {
  children?: MenuTreeNode[];
}

/** 默认菜单树种子数据（目录 + 菜单 + 按钮） */
const DEFAULT_MENUS = [
  {
    menuName: '驾驶舱',
    menuType: 1,
    path: '/dashboard',
    icon: 'DashboardOutlined',
    sortNo: 1,
    buttons: [
      { name: '查看全局数据', permission: 'dashboard:view-all' },
    ],
  },
  {
    menuName: '订单管理',
    menuType: 1,
    path: '/orders',
    icon: 'ShoppingCartOutlined',
    sortNo: 2,
    buttons: [
      { name: '查询', permission: 'order:query' },
      { name: '新增', permission: 'order:create' },
      { name: '编辑', permission: 'order:edit' },
      { name: '删除', permission: 'order:delete' },
      { name: '取消', permission: 'order:cancel' },
      { name: '导入', permission: 'order:import' },
      { name: '导出', permission: 'order:export' },
    ],
  },
  {
    menuName: '发货管理',
    menuType: 1,
    path: '/shipments',
    icon: 'SendOutlined',
    sortNo: 3,
    buttons: [
      { name: '查询', permission: 'shipment:query' },
      { name: '新增', permission: 'shipment:create' },
      { name: '编辑', permission: 'shipment:edit' },
      { name: '导出', permission: 'shipment:export' },
    ],
  },
  {
    menuName: '收款管理',
    menuType: 1,
    path: '/payments',
    icon: 'DollarOutlined',
    sortNo: 4,
    buttons: [
      { name: '查询', permission: 'payment:query' },
      { name: '新增', permission: 'payment:create' },
      { name: '导出', permission: 'payment:export' },
    ],
  },
  {
    menuName: '商品管理',
    menuType: 0,
    icon: 'AppstoreOutlined',
    sortNo: 5,
    children: [
      {
        menuName: '商品管理',
        menuType: 1,
        path: '/products',
        sortNo: 1,
        buttons: [
          { name: '查询', permission: 'product:query' },
          { name: '新增', permission: 'product:create' },
          { name: '编辑', permission: 'product:edit' },
          { name: '导入', permission: 'product:import' },
          { name: '导出', permission: 'product:export' },
        ],
      },
      {
        menuName: '商品分类',
        menuType: 1,
        path: '/categories',
        sortNo: 2,
        buttons: [
          { name: '查询', permission: 'category:query' },
          { name: '新增', permission: 'category:create' },
          { name: '编辑', permission: 'category:edit' },
        ],
      },
    ],
  },
  {
    menuName: '采购管理',
    menuType: 0,
    icon: 'ShopOutlined',
    sortNo: 6,
    children: [
      {
        menuName: '采购订单',
        menuType: 1,
        path: '/purchase-orders',
        sortNo: 1,
        buttons: [
          { name: '查询', permission: 'purchase-order:query' },
          { name: '新增', permission: 'purchase-order:create' },
          { name: '编辑', permission: 'purchase-order:edit' },
          { name: '删除', permission: 'purchase-order:delete' },
          { name: '导入', permission: 'purchase-order:import' },
          { name: '导出', permission: 'purchase-order:export' },
          { name: '入库', permission: 'purchase-order:receipt' },
          { name: '关闭', permission: 'purchase-order:close' },
        ],
      },
      {
        menuName: '入库管理',
        menuType: 1,
        path: '/purchase-receipts',
        sortNo: 2,
        buttons: [
          { name: '查询', permission: 'purchase-receipt:query' },
          { name: '新增', permission: 'purchase-receipt:create' },
          { name: '导出', permission: 'purchase-receipt:export' },
        ],
      },
    ],
  },
  {
    menuName: '库存管理',
    menuType: 0,
    icon: 'InboxOutlined',
    sortNo: 7,
    children: [
      {
        menuName: '当前库存',
        menuType: 1,
        path: '/inventory',
        sortNo: 1,
        buttons: [
          { name: '查询', permission: 'inventory:query' },
          { name: '导出', permission: 'inventory:export' },
        ],
      },
      {
        menuName: '库存流水',
        menuType: 1,
        path: '/inventory-flows',
        sortNo: 2,
        buttons: [{ name: '查询', permission: 'inventory-flow:query' }],
      },
      {
        menuName: '库存调整',
        menuType: 1,
        path: '/inventory-adjustments',
        sortNo: 3,
        buttons: [
          { name: '查询', permission: 'inventory-adjustment:query' },
          { name: '新增', permission: 'inventory-adjustment:create' },
          { name: '导出', permission: 'inventory-adjustment:export' },
        ],
      },
    ],
  },
  {
    menuName: '退货管理',
    menuType: 0,
    icon: 'SendOutlined',
    sortNo: 8,
    children: [
      {
        menuName: '客户退货',
        menuType: 1,
        path: '/sales-returns',
        sortNo: 1,
        buttons: [
          { name: '查询', permission: 'sales-return:query' },
          { name: '新增', permission: 'sales-return:create' },
          { name: '导出', permission: 'sales-return:export' },
        ],
      },
      {
        menuName: '采购退货',
        menuType: 1,
        path: '/purchase-returns',
        sortNo: 2,
        buttons: [
          { name: '查询', permission: 'purchase-return:query' },
          { name: '新增', permission: 'purchase-return:create' },
          { name: '导出', permission: 'purchase-return:export' },
        ],
      },
    ],
  },
  {
    menuName: '财务管理',
    menuType: 0,
    icon: 'AccountBookOutlined',
    sortNo: 9,
    children: [
      {
        menuName: '提成管理',
        menuType: 1,
        path: '/commission',
        sortNo: 1,
        buttons: [
          { name: '查询', permission: 'commission:query' },
          { name: '结算', permission: 'commission:settle' },
          { name: '发放', permission: 'commission:confirm' },
        ],
      },
      {
        menuName: '汇率管理',
        menuType: 1,
        path: '/exchange-rates',
        sortNo: 2,
        buttons: [
          { name: '查询', permission: 'exchange-rate:query' },
          { name: '新增', permission: 'exchange-rate:create' },
          { name: '编辑', permission: 'exchange-rate:edit' },
          { name: '删除', permission: 'exchange-rate:delete' },
          { name: '同步', permission: 'exchange-rate:sync' },
        ],
      },
    ],
  },
  {
    menuName: '基础资料',
    menuType: 0,
    icon: 'DatabaseOutlined',
    sortNo: 10,
    children: [
      {
        menuName: '供应商管理',
        menuType: 1,
        path: '/suppliers',
        icon: 'TeamOutlined',
        sortNo: 1,
        buttons: [
          { name: '查询', permission: 'supplier:query' },
          { name: '新增', permission: 'supplier:create' },
          { name: '编辑', permission: 'supplier:edit' },
          { name: '导入', permission: 'supplier:import' },
          { name: '导出', permission: 'supplier:export' },
        ],
      },
      {
        menuName: '销售员管理',
        menuType: 1,
        path: '/salespersons',
        icon: 'UserOutlined',
        sortNo: 2,
        buttons: [
          { name: '查询', permission: 'salesperson:query' },
          { name: '新增', permission: 'salesperson:create' },
          { name: '编辑', permission: 'salesperson:edit' },
        ],
      },
      {
        menuName: '快递公司',
        menuType: 1,
        path: '/express-companies',
        icon: 'CarOutlined',
        sortNo: 3,
        buttons: [
          { name: '查询', permission: 'express-company:query' },
          { name: '新增', permission: 'express-company:create' },
          { name: '编辑', permission: 'express-company:edit' },
        ],
      },
      {
        menuName: '运输渠道',
        menuType: 1,
        path: '/transport-channels',
        icon: 'SendOutlined',
        sortNo: 4,
        buttons: [
          { name: '查询', permission: 'transport-channel:query' },
          { name: '新增', permission: 'transport-channel:create' },
          { name: '编辑', permission: 'transport-channel:edit' },
        ],
      },
      {
        menuName: '成本类型',
        menuType: 1,
        path: '/cost-types',
        icon: 'DollarOutlined',
        sortNo: 5,
        buttons: [
          { name: '查询', permission: 'cost-type:query' },
          { name: '新增', permission: 'cost-type:create' },
          { name: '编辑', permission: 'cost-type:edit' },
        ],
      },
      {
        menuName: '常用联系人',
        menuType: 1,
        path: '/common-contacts',
        icon: 'ContactsOutlined',
        sortNo: 6,
        buttons: [
          { name: '查询', permission: 'common-contact:query' },
          { name: '新增', permission: 'common-contact:create' },
          { name: '编辑', permission: 'common-contact:edit' },
          { name: '删除', permission: 'common-contact:delete' },
        ],
      },
      {
        menuName: '系统参数',
        menuType: 1,
        path: '/system-configs',
        icon: 'SettingOutlined',
        sortNo: 7,
        buttons: [
          { name: '查询', permission: 'system-config:query' },
          { name: '新增', permission: 'system-config:create' },
          { name: '编辑', permission: 'system-config:edit' },
        ],
      },
    ],
  },
  {
    menuName: '系统管理',
    menuType: 0,
    icon: 'SettingOutlined',
    sortNo: 11,
    children: [
      {
        menuName: '用户管理',
        menuType: 1,
        path: '/system/users',
        sortNo: 1,
        buttons: [
          { name: '查询', permission: 'user:query' },
          { name: '新增', permission: 'user:create' },
          { name: '编辑', permission: 'user:edit' },
          { name: '重置密码', permission: 'user:reset-password' },
        ],
      },
      {
        menuName: '角色管理',
        menuType: 1,
        path: '/system/roles',
        sortNo: 2,
        buttons: [
          { name: '查询', permission: 'role:query' },
          { name: '新增', permission: 'role:create' },
          { name: '编辑', permission: 'role:edit' },
          { name: '删除', permission: 'role:delete' },
          { name: '分配权限', permission: 'role:assign-menus' },
        ],
      },
      {
        menuName: '菜单管理',
        menuType: 1,
        path: '/system/menus',
        sortNo: 3,
        buttons: [
          { name: '查询', permission: 'menu:query' },
          { name: '新增', permission: 'menu:create' },
          { name: '编辑', permission: 'menu:edit' },
          { name: '删除', permission: 'menu:delete' },
        ],
      },
      {
        menuName: '操作日志',
        menuType: 1,
        path: '/system/logs',
        sortNo: 4,
        buttons: [{ name: '查询', permission: 'operation-log:query' }],
      },
      {
        menuName: '登录日志',
        menuType: 1,
        path: '/system/login-logs',
        sortNo: 5,
        buttons: [{ name: '查询', permission: 'login-log:query' }],
      },
      {
        menuName: '字典管理',
        menuType: 1,
        path: '/system/dict-manage',
        sortNo: 6,
        buttons: [
          { name: '查询', permission: 'dict-manage:query' },
          { name: '新增', permission: 'dict-manage:create' },
          { name: '编辑', permission: 'dict-manage:edit' },
        ],
      },
    ],
  },
];

/**
 * 菜单管理服务
 * 提供菜单 CRUD、树形查询、用户权限查询等功能
 */
@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    @InjectRepository(SysMenu)
    private readonly menuRepo: Repository<SysMenu>,
    @InjectRepository(SysRoleMenu)
    private readonly roleMenuRepo: Repository<SysRoleMenu>,
    @InjectRepository(SysUserRole)
    private readonly userRoleRepo: Repository<SysUserRole>,
  ) {}

  /**
   * 查询全部菜单并构建树形结构（不含按钮，用于侧边栏/权限分配）
   */
  async findAll() {
    const menus = await this.menuRepo
      .createQueryBuilder('menu')
      .where('menu.menuType != :buttonType', { buttonType: 2 })
      .orderBy('menu.sortNo', 'ASC')
      .addOrderBy('menu.createdTime', 'ASC')
      .getMany();

    return this.buildTree(menus);
  }

  /**
   * 查询全部菜单含按钮（用于菜单管理页面）
   */
  async findAllWithButtons(query?: { keyword?: string; status?: number }) {
    const qb = this.menuRepo.createQueryBuilder('menu');

    if (query?.keyword) {
      qb.andWhere('menu.menuName LIKE :kw', { kw: `%${query.keyword}%` });
    }
    if (query?.status !== undefined) {
      qb.andWhere('menu.status = :status', { status: query.status });
    }

    const menus = await qb
      .orderBy('menu.sortNo', 'ASC')
      .addOrderBy('menu.createdTime', 'ASC')
      .getMany();

    return this.buildTree(menus);
  }

  /**
   * 根据 ID 查询菜单详情
   */
  async findOne(id: string) {
    const menu = await this.menuRepo.findOne({ where: { id } });
    if (!menu) {
      throw new NotFoundException('菜单不存在');
    }
    return menu;
  }

  /**
   * 创建菜单
   */
  async create(data: {
    parentId?: string;
    menuName: string;
    menuType: number;
    permission?: string;
    path?: string;
    component?: string;
    icon?: string;
    sortNo?: number;
    visible?: number;
    status?: number;
  }) {
    const menu = this.menuRepo.create({
      id: snowflake.nextId(),
      parentId: data.parentId || null,
      menuName: data.menuName,
      menuType: data.menuType,
      permission: data.permission || null,
      path: data.path || null,
      component: data.component || null,
      icon: data.icon || null,
      sortNo: data.sortNo ?? 0,
      visible: data.visible ?? 1,
      status: data.status ?? 1,
    });

    return this.menuRepo.save(menu);
  }

  /**
   * 更新菜单
   */
  async update(
    id: string,
    data: Partial<{
      parentId: string;
      menuName: string;
      menuType: number;
      permission: string;
      path: string;
      component: string;
      icon: string;
      sortNo: number;
      visible: number;
      status: number;
    }>,
  ) {
    const menu = await this.menuRepo.findOne({ where: { id } });
    if (!menu) {
      throw new NotFoundException('菜单不存在');
    }

    if (data.parentId !== undefined) menu.parentId = data.parentId || null;
    if (data.menuName !== undefined) menu.menuName = data.menuName;
    if (data.menuType !== undefined) menu.menuType = data.menuType;
    if (data.permission !== undefined)
      menu.permission = data.permission || null;
    if (data.path !== undefined) menu.path = data.path || null;
    if (data.component !== undefined) menu.component = data.component || null;
    if (data.icon !== undefined) menu.icon = data.icon || null;
    if (data.sortNo !== undefined) menu.sortNo = data.sortNo;
    if (data.visible !== undefined) menu.visible = data.visible;
    if (data.status !== undefined) menu.status = data.status;

    return this.menuRepo.save(menu);
  }

  /**
   * 删除菜单（有子菜单或角色关联时禁止删除）
   */
  async delete(id: string) {
    const menu = await this.menuRepo.findOne({ where: { id } });
    if (!menu) {
      throw new NotFoundException('菜单不存在');
    }

    // 检查是否有子菜单
    const childCount = await this.menuRepo.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new ConflictException('该菜单下有子菜单，无法删除');
    }

    // 检查是否有角色关联
    const roleMenuCount = await this.roleMenuRepo.count({
      where: { menuId: id },
    });
    if (roleMenuCount > 0) {
      throw new ConflictException('该菜单已被角色引用，无法删除');
    }

    await this.menuRepo.remove(menu);
  }

  /**
   * 查询当前用户的菜单树 + 权限标识列表
   * @param userId 用户 ID
   * @returns { menus: MenuTreeNode[], permissions: string[] }
   */
  async findUserPermissions(userId: string) {
    // 1. 查询用户角色
    const userRoles = await this.userRoleRepo.find({ where: { userId } });
    if (userRoles.length === 0) {
      return { menus: [], permissions: [] };
    }

    const roleIds = userRoles.map((ur) => ur.roleId);

    // 2. 检查是否有 SUPER_ADMIN 角色（拥有全部权限）
    const allMenus = await this.menuRepo
      .createQueryBuilder('menu')
      .where('menu.status = :status', { status: 1 })
      .orderBy('menu.sortNo', 'ASC')
      .addOrderBy('menu.createdTime', 'ASC')
      .getMany();

    // 3. 查询角色关联的菜单
    const roleMenus = await this.roleMenuRepo
      .createQueryBuilder('rm')
      .where('rm.roleId IN (:...roleIds)', { roleIds })
      .getMany();

    const menuIds = [...new Set(roleMenus.map((rm) => rm.menuId))];

    // 4. 筛选用户有权限的菜单
    const userMenus = allMenus.filter((m) => menuIds.includes(m.id));

    // 5. 提取权限标识列表（仅按钮类型）
    const permissions = userMenus
      .filter((m) => m.menuType === 2 && m.permission)
      .map((m) => m.permission as string);

    // 6. 构建树形结构（仅目录和菜单，不含按钮）
    const menuTree = this.buildTree(userMenus.filter((m) => m.menuType !== 2));

    return { menus: menuTree, permissions };
  }

  /**
   * 查询全部权限标识（SUPER_ADMIN 专用）
   * @returns 所有启用的按钮权限标识列表
   */
  async findAllPermissions(): Promise<string[]> {
    const menus = await this.menuRepo
      .createQueryBuilder('menu')
      .where('menu.menuType = :menuType', { menuType: 2 })
      .andWhere('menu.status = :status', { status: 1 })
      .getMany();

    return menus.map((m) => m.permission).filter(Boolean) as string[];
  }

  /**
   * 构建菜单树
   */
  private buildTree(menus: SysMenu[]): MenuTreeNode[] {
    const menuMap = new Map<string, MenuTreeNode>();
    const roots: MenuTreeNode[] = [];

    // 创建映射
    for (const menu of menus) {
      menuMap.set(menu.id, { ...menu, children: [] });
    }

    // 构建树
    for (const menu of menus) {
      const node = menuMap.get(menu.id)!;
      if (menu.parentId && menuMap.has(menu.parentId)) {
        menuMap.get(menu.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    // 清理空 children
    const cleanTree = (nodes: MenuTreeNode[]): MenuTreeNode[] =>
      nodes.map((node) => {
        if (node.children && node.children.length === 0) {
          const { children: _children, ...rest } = node;
          void _children;
          return rest;
        }
        return {
          ...node,
          children: node.children ? cleanTree(node.children) : undefined,
        };
      });

    return cleanTree(roots);
  }

  /**
   * 初始化默认菜单树种子数据
   */
  async seedMenus() {
    const existingCount = await this.menuRepo.count();
    if (existingCount > 0) {
      return []; // 已有菜单数据，跳过初始化
    }

    const allMenus: SysMenu[] = [];

    const createMenuRecursive = async (
      items: Array<{
        menuName: string;
        menuType: number;
        path?: string;
        icon?: string;
        sortNo: number;
        buttons?: Array<{ name: string; permission: string }>;
        children?: Array<{
          menuName: string;
          menuType: number;
          path?: string;
          icon?: string;
          sortNo: number;
          buttons?: Array<{ name: string; permission: string }>;
        }>;
      }>,
      parentId: string | null = null,
    ) => {
      for (const item of items) {
        const menu = this.menuRepo.create({
          id: snowflake.nextId(),
          parentId,
          menuName: item.menuName,
          menuType: item.menuType,
          path: item.path || null,
          icon: item.icon || null,
          sortNo: item.sortNo,
          visible: 1,
          status: 1,
        });
        const saved = await this.menuRepo.save(menu);
        allMenus.push(saved);

        // 创建按钮权限
        if (item.buttons && item.buttons.length > 0) {
          let btnSort = 1;
          for (const btn of item.buttons) {
            const btnMenu = this.menuRepo.create({
              id: snowflake.nextId(),
              parentId: saved.id,
              menuName: btn.name,
              menuType: 2, // 按钮
              permission: btn.permission,
              sortNo: btnSort++,
              visible: 1,
              status: 1,
            });
            const savedBtn = await this.menuRepo.save(btnMenu);
            allMenus.push(savedBtn);
          }
        }

        // 递归创建子菜单
        if (item.children && item.children.length > 0) {
          await createMenuRecursive(item.children, saved.id);
        }
      }
    };

    await createMenuRecursive(DEFAULT_MENUS);

    this.logger.log(`已初始化 ${allMenus.length} 个默认菜单/按钮`);
    return allMenus;
  }

  /**
   * 初始化角色-菜单关联（按权限矩阵）
   */
  async seedRoleMenus() {
    const existingCount = await this.roleMenuRepo.count();
    if (existingCount > 0) {
      return; // 已有关联数据，跳过
    }

    // 查询全部菜单
    const allMenus = await this.menuRepo.find();
    const menuMap = new Map<string, SysMenu>();
    for (const m of allMenus) {
      menuMap.set(m.permission || `${m.menuName}-${m.id}`, m);
    }

    // 查询全部角色
    const roleRepo = this.menuRepo.manager.getRepository('SysRole');
    const roles = (await roleRepo.find()) as Array<{
      id: string;
      roleCode: string;
    }>;

    const superAdmin = roles.find((r) => r.roleCode === 'SUPER_ADMIN');

    // SUPER_ADMIN: 所有菜单
    if (superAdmin) {
      for (const menu of allMenus) {
        await this.roleMenuRepo.save(
          this.roleMenuRepo.create({ roleId: superAdmin.id, menuId: menu.id }),
        );
      }
    }

    // 其他角色按权限矩阵分配
    const rolePermissions: Record<string, string[]> = {
      BOSS: [
        'dashboard', // 驾驶舱全部
        'dashboard:view-all', // 查看全局驾驶舱数据
        'order:query',
        'order:export',
        'shipment:query',
        'shipment:export',
        'payment:query',
        'payment:export',
        'commission:query',
        'commission:settle',
        'commission:confirm',
        'exchange-rate:query',
        'exchange-rate:create',
        'exchange-rate:edit',
        'exchange-rate:delete',
        'exchange-rate:sync',
        'purchase-order:query',
        'purchase-order:export',
        'purchase-receipt:query',
        'purchase-receipt:export',
        'inventory:query',
        'inventory:export',
        'inventory-flow:query',
        'inventory-adjustment:query',
        'inventory-adjustment:export',
        'sales-return:query',
        'sales-return:export',
        'purchase-return:query',
        'purchase-return:export',
        'product:query',
        'product:export',
        'category:query',
        'supplier:query',
        'supplier:export',
        'salesperson:query',
        'express-company:query',
        'transport-channel:query',
        'cost-type:query',
        'common-contact:query',
        'system-config:query',
        'system-config:create',
        'system-config:edit',
        'operation-log:query',
        'login-log:query',
        'dict-manage:query',
        'dict-manage:create',
        'dict-manage:edit',
        'user:query',
      ],
      SALES: [
        'dashboard',
        'order:query',
        'order:create',
        'order:edit',
        'order:cancel',
        'order:import',
        'order:export',
        'shipment:query',
        'payment:query',
        'commission:query',
        'inventory:query',
        'inventory-flow:query',
        'product:query',
        'category:query',
        'supplier:query',
        'salesperson:query',
        'common-contact:query',
      ],
      PURCHASER: [
        'dashboard',
        'order:query',
        'shipment:query',
        'purchase-order:query',
        'purchase-order:create',
        'purchase-order:edit',
        'purchase-order:receipt',
        'purchase-order:close',
        'purchase-order:import',
        'purchase-order:export',
        'purchase-receipt:query',
        'purchase-receipt:create',
        'purchase-receipt:export',
        'inventory:query',
        'inventory-flow:query',
        'sales-return:query',
        'purchase-return:query',
        'purchase-return:create',
        'purchase-return:export',
        'product:query',
        'product:create',
        'product:edit',
        'product:import',
        'product:export',
        'category:query',
        'category:create',
        'category:edit',
        'supplier:query',
        'supplier:create',
        'supplier:edit',
        'supplier:import',
        'supplier:export',
        'express-company:query',
        'transport-channel:query',
        'cost-type:query',
        'common-contact:query',
        'common-contact:create',
        'common-contact:edit',
        'common-contact:delete',
      ],
      WAREHOUSE: [
        'dashboard',
        'order:query',
        'shipment:query',
        'shipment:create',
        'shipment:edit',
        'shipment:export',
        'purchase-order:query',
        'purchase-receipt:query',
        'inventory:query',
        'inventory:export',
        'inventory-flow:query',
        'inventory-adjustment:query',
        'inventory-adjustment:create',
        'inventory-adjustment:export',
        'sales-return:query',
        'sales-return:export',
        'purchase-return:query',
        'product:query',
        'category:query',
        'supplier:query',
        'express-company:query',
        'transport-channel:query',
        'common-contact:query',
      ],
      FINANCE: [
        'dashboard',
        'dashboard:view-all', // 查看全局驾驶舱数据
        'order:query',
        'order:export',
        'shipment:query',
        'payment:query',
        'payment:create',
        'payment:export',
        'commission:query',
        'commission:settle',
        'commission:confirm',
        'exchange-rate:query',
        'exchange-rate:create',
        'exchange-rate:edit',
        'exchange-rate:sync',
        'purchase-order:query',
        'inventory:query',
        'inventory-flow:query',
        'sales-return:query',
        'purchase-return:query',
        'product:query',
        'category:query',
        'supplier:query',
        'salesperson:query',
        'express-company:query',
        'common-contact:query',
        'system-config:query',
      ],
    };

    for (const [roleCode, permissions] of Object.entries(rolePermissions)) {
      const role = roles.find((r) => r.roleCode === roleCode);
      if (!role) continue;

      for (const perm of permissions) {
        // 查找匹配菜单（按钮按 permission 匹配，目录按特殊标记匹配）
        if (perm === 'dashboard') {
          // 驾驶舱：分配目录菜单本身
          const dashboardMenu = allMenus.find(
            (m) => m.menuName === '驾驶舱' && m.menuType === 1,
          );
          if (dashboardMenu) {
            await this.roleMenuRepo.save(
              this.roleMenuRepo.create({
                roleId: role.id,
                menuId: dashboardMenu.id,
              }),
            );
          }
          continue;
        }

        // 按 permission 标识查找按钮
        const btnMenu = allMenus.find((m) => m.permission === perm);
        if (btnMenu) {
          await this.roleMenuRepo.save(
            this.roleMenuRepo.create({ roleId: role.id, menuId: btnMenu.id }),
          );

          // 同时分配按钮所属的父菜单（确保能看到页面）
          if (btnMenu.parentId) {
            const parentExists = await this.roleMenuRepo.findOne({
              where: { roleId: role.id, menuId: btnMenu.parentId },
            });
            if (!parentExists) {
              await this.roleMenuRepo.save(
                this.roleMenuRepo.create({
                  roleId: role.id,
                  menuId: btnMenu.parentId,
                }),
              );
            }

            // 再检查爷爷菜单（目录级）
            const parent = allMenus.find((m) => m.id === btnMenu.parentId);
            if (parent && parent.parentId) {
              const grandParentExists = await this.roleMenuRepo.findOne({
                where: { roleId: role.id, menuId: parent.parentId },
              });
              if (!grandParentExists) {
                await this.roleMenuRepo.save(
                  this.roleMenuRepo.create({
                    roleId: role.id,
                    menuId: parent.parentId,
                  }),
                );
              }
            }
          }
        }
      }
    }

    this.logger.log('已初始化角色-菜单关联数据');
  }
}
