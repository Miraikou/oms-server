import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '../../src/app.module'

/**
 * RBAC 权限 E2E 测试
 * 验证角色 CRUD、菜单分配、权限拦截
 */
describe('RBAC E2E', () => {
  let app: INestApplication
  let adminToken: string

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      enableImplicitConversion: true,
    }))
    await app.init()

    // 获取管理员 token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'admin123' })
    adminToken = loginRes.body.data.accessToken
  }, 30000)

  afterAll(async () => {
    await app.close()
  })

  describe('角色管理', () => {
    let roleId: string

    it('GET /api/v1/roles 应返回角色列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)

      expect(res.body.data.list).toBeDefined()
      expect(Array.isArray(res.body.data.list)).toBe(true)
      // 应有 6 个默认角色
      expect(res.body.data.total).toBeGreaterThanOrEqual(6)
    })

    it('GET /api/v1/roles/all 应返回启用角色', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles/all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)

      expect(Array.isArray(res.body.data)).toBe(true)
      const codes = res.body.data.map((r: any) => r.roleCode)
      expect(codes).toContain('SUPER_ADMIN')
      expect(codes).toContain('SALES')
    })

    it('POST /api/v1/roles 应创建新角色', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          roleName: 'E2E测试角色',
          roleCode: 'E2E_TEST',
          status: 1,
        })
        .expect(201)

      roleId = res.body.data.id
      expect(res.body.data.roleName).toBe('E2E测试角色')
    })

    it('角色名称重复应返回 409', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleName: 'E2E测试角色', roleCode: 'E2E_DUP' })
        .expect(409)
    })

    it('PUT /api/v1/roles/:id/menus 应分配菜单权限', async () => {
      // 先获取菜单树
      const menuRes = await request(app.getHttpServer())
        .get('/api/v1/menus')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)

      const menuIds = menuRes.body.data.slice(0, 3).map((m: any) => m.id)

      const res = await request(app.getHttpServer())
        .put(`/api/v1/roles/${roleId}/menus`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ menuIds })
        .expect(200)

      expect(res.body.data.menuIds).toEqual(menuIds)
    })

    it('GET /api/v1/roles/:id 应返回含 menuIds 的角色详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/roles/${roleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)

      expect(res.body.data.roleName).toBe('E2E测试角色')
      expect(res.body.data.menuIds).toBeDefined()
      expect(res.body.data.menuIds.length).toBeGreaterThan(0)
    })

    it('DELETE /api/v1/roles/:id 应删除角色', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/roles/${roleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
    })
  })

  describe('菜单管理', () => {
    it('GET /api/v1/menus 应返回树形菜单（含按钮）', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/menus')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)

      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBeGreaterThan(0)
      // 检查树形结构
      const firstRoot = res.body.data[0]
      expect(firstRoot.menuName).toBeDefined()
    })
  })

  describe('用户管理 + 角色分配', () => {
    let userId: string

    it('POST /api/v1/users 应创建用户并分配角色', async () => {
      // 获取 SALES 角色 ID
      const rolesRes = await request(app.getHttpServer())
        .get('/api/v1/roles/all')
        .set('Authorization', `Bearer ${adminToken}`)
      const salesRole = rolesRes.body.data.find((r: any) => r.roleCode === 'SALES')

      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'e2e_sales',
          password: 'test123456',
          realName: 'E2E测试销售',
          roleIds: [salesRole.id],
        })
        .expect(201)

      userId = res.body.data.id
      expect(res.body.data.username).toBe('e2e_sales')
    })

    it('GET /api/v1/users/:id 应返回含角色的用户详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)

      expect(res.body.data.roles).toBeDefined()
      expect(res.body.data.roles.length).toBeGreaterThan(0)
      expect(res.body.data.roles[0].roleCode).toBe('SALES')
    })
  })
})
