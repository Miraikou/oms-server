import * as jwt from '@nestjs/jwt'

/**
 * 生成测试用 JWT Token
 * @param payload JWT payload
 * @param secret 密钥（默认与开发环境一致）
 */
export function generateTestToken(
  payload: { sub: string; username: string },
  secret = 'oms-dev-secret',
): string {
  const jwtService = new jwt.JwtService({ secret })
  return jwtService.sign(payload, { expiresIn: '1h' })
}

/** 默认管理员 Token */
export const ADMIN_TOKEN = generateTestToken({
  sub: '1000000000000001',
  username: 'admin',
})

/** 默认测试用户 Token */
export const USER_TOKEN = generateTestToken({
  sub: '1000000000000002',
  username: 'testuser',
})
