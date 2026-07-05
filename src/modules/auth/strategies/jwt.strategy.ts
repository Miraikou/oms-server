import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/** JWT Payload 结构 */
export interface JwtPayload {
  sub: string;
  username: string;
}

/**
 * JWT 认证策略
 * 从 Authorization: Bearer <token> 中提取并验证 JWT
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'oms-dev-secret'),
    });
  }

  /**
   * 验证通过后将 payload 注入到 request.user
   */
  validate(payload: JwtPayload): JwtPayload {
    return { sub: payload.sub, username: payload.username };
  }
}
