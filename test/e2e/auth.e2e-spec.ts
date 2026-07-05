import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import * as request from 'supertest'
import { AppModule } from '../../src/app.module'

/**
 * 认证模块 E2E 测试
 * 需要运行中的 MySQL + Redis（使用 docker-compose.test.yml）
 */
describe('Auth E2E', () => {
  let app: INestApplication
  let accessToken: string
  let refreshToken: string

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
  }, 30000)

  afterAll(async () => {
    await app.close()
  })

  describe('POST /api/v1/auth/login', () => {
    it('管理员登录应返回 token 和用户信息', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'admin123' })
        .expect(200)

      expect(res.body.code).toBe(0)
      expect(res.body.data.accessToken).toBeDefined()
      expect(res.body.data.refreshToken).toBeDefined()
      expect(res.body.data.user.username).toBe('admin')
      expect(res.body.data.user.roles).toContain('SUPER_ADMIN')

      accessToken = res.body.data.accessToken
      refreshToken = res.body.data.refreshToken
    })

    it('错误密码应返回 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'admin', password: 'wrong' })
        .expect(401)
    })

    it('缺少用户名应返回 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ password: 'admin123' })
        .expect(400)
    })
  })

  describe('POST /api/v1/auth/refresh', () => {
    it('有效 refreshToken 应返回新 accessToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200)

      expect(res.body.data.accessToken).toBeDefined()
    })
  })

  describe('GET /api/v1/auth/me', () => {
    it('有效 token 应返回用户信息', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body.data.username).toBe('admin')
      expect(res.body.data.roles).toContain('SUPER_ADMIN')
    })

    it('无 token 应返回 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401)
    })
  })

  describe('GET /api/v1/auth/menus', () => {
    it('管理员应返回完整菜单树和权限列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/menus')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      expect(res.body.data.menus).toBeDefined()
      expect(Array.isArray(res.body.data.menus)).toBe(true)
      expect(res.body.data.permissions).toBeDefined()
      expect(Array.isArray(res.body.data.permissions)).toBe(true)
      // SUPER_ADMIN 应有权限
      expect(res.body.data.permissions.length).toBeGreaterThan(0)
    })
  })
})
