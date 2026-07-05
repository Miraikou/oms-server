import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT 认证守卫
 * 基于 passport-jwt 策略，验证请求中的 Bearer Token
 *
 * @example
 * ```ts
 * @UseGuards(JwtAuthGuard)
 * @Get('profile')
 * getProfile() { ... }
 * ```
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
