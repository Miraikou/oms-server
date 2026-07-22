-- ============================================
-- OMS 用户手册（帮助文档）— 数据库迁移脚本
-- 适用场景：已有环境（菜单表已有数据，seedMenus 不会重跑）
-- 新环境无需执行：表由 TypeORM synchronize 创建，菜单由 seedMenus 初始化
-- 执行前请先备份数据库！
-- ============================================

-- ============================================
-- 第一步：创建帮助文档表（synchronize 开启的环境会自动建表，此处兜底）
-- ============================================
CREATE TABLE IF NOT EXISTS help_doc (
  id BIGINT PRIMARY KEY,
  title VARCHAR(200) NOT NULL COMMENT '文档标题',
  category VARCHAR(50) NOT NULL COMMENT '所属分类',
  content LONGTEXT NOT NULL COMMENT 'Markdown 正文',
  route_path VARCHAR(500) NULL COMMENT '绑定路由（逗号分隔多个前缀，用于页面上下文帮助定位）',
  sort_order INT NOT NULL DEFAULT 0 COMMENT '排序号（升序）',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '状态：1=已发布，0=草稿',
  created_by BIGINT NULL COMMENT '创建人ID',
  created_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_by BIGINT NULL COMMENT '修改人ID',
  updated_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
  remark VARCHAR(500) NULL COMMENT '备注',
  KEY idx_hd_category (category),
  KEY idx_hd_status (status)
) COMMENT '帮助文档表';

-- ============================================
-- 第二步：新增「帮助文档管理」菜单（挂在「系统管理」目录下）
-- ID 采用 当前毫秒时间戳 + 序号，与雪花 ID 空间不冲突
-- ============================================
SET @base_id = FLOOR(UNIX_TIMESTAMP(NOW(3)) * 1000);

INSERT INTO sys_menu (id, parent_id, menu_name, menu_type, permission, path, component, icon, sort_no, visible, status, created_time, updated_time)
SELECT @base_id + 1, m.id, '帮助文档管理', 1, NULL, '/system/help-docs', NULL, NULL, 7, 1, 1, NOW(), NOW()
FROM sys_menu m
WHERE m.menu_name = '系统管理' AND m.menu_type = 0
  AND NOT EXISTS (
    SELECT 1 FROM sys_menu x
    WHERE x.menu_name = '帮助文档管理' AND x.parent_id = m.id
  );

-- 回查真实菜单 ID（兼容脚本重复执行的情况）
SELECT id INTO @menu_id
FROM sys_menu
WHERE menu_name = '帮助文档管理' AND menu_type = 1
LIMIT 1;

-- ============================================
-- 第三步：新增按钮权限（query/create/edit/delete）
-- ============================================
INSERT INTO sys_menu (id, parent_id, menu_name, menu_type, permission, path, component, icon, sort_no, visible, status, created_time, updated_time)
SELECT @base_id + 2, @menu_id, '查询', 2, 'help-doc:query', NULL, NULL, NULL, 1, 1, 1, NOW(), NOW()
FROM DUAL
WHERE @menu_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys_menu x WHERE x.permission = 'help-doc:query' AND x.parent_id = @menu_id);

INSERT INTO sys_menu (id, parent_id, menu_name, menu_type, permission, path, component, icon, sort_no, visible, status, created_time, updated_time)
SELECT @base_id + 3, @menu_id, '新增', 2, 'help-doc:create', NULL, NULL, NULL, 2, 1, 1, NOW(), NOW()
FROM DUAL
WHERE @menu_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys_menu x WHERE x.permission = 'help-doc:create' AND x.parent_id = @menu_id);

INSERT INTO sys_menu (id, parent_id, menu_name, menu_type, permission, path, component, icon, sort_no, visible, status, created_time, updated_time)
SELECT @base_id + 4, @menu_id, '编辑', 2, 'help-doc:edit', NULL, NULL, NULL, 3, 1, 1, NOW(), NOW()
FROM DUAL
WHERE @menu_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys_menu x WHERE x.permission = 'help-doc:edit' AND x.parent_id = @menu_id);

INSERT INTO sys_menu (id, parent_id, menu_name, menu_type, permission, path, component, icon, sort_no, visible, status, created_time, updated_time)
SELECT @base_id + 5, @menu_id, '删除', 2, 'help-doc:delete', NULL, NULL, NULL, 4, 1, 1, NOW(), NOW()
FROM DUAL
WHERE @menu_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sys_menu x WHERE x.permission = 'help-doc:delete' AND x.parent_id = @menu_id);

-- ============================================
-- 第四步：为 SUPER_ADMIN 授权（菜单 + 4 个按钮）
-- ============================================
INSERT INTO sys_role_menu (role_id, menu_id)
SELECT r.id, m.id
FROM sys_role r
JOIN sys_menu m ON m.id = @menu_id OR (m.parent_id = @menu_id AND m.menu_type = 2)
WHERE r.role_code = 'SUPER_ADMIN'
  AND @menu_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys_role_menu rm
    WHERE rm.role_id = r.id AND rm.menu_id = m.id
  );

-- ============================================
-- 验证（可选）：
-- SELECT * FROM sys_menu WHERE menu_name = '帮助文档管理' OR permission LIKE 'help-doc:%';
-- SELECT COUNT(*) FROM sys_role_menu rm JOIN sys_menu m ON rm.menu_id = m.id WHERE m.permission LIKE 'help-doc:%' OR m.menu_name = '帮助文档管理';
-- ============================================
