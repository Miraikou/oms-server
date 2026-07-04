import {
  Entity,
  Column,
  Index,
} from 'typeorm'

/**
 * 登录日志实体
 * 对应 sys_login_log 表，记录所有登录行为
 * 不使用 BaseEntity，因为登录日志不需要审计字段
 */
@Entity('sys_login_log')
export class SysLoginLog {
  @Column({ type: 'bigint', primary: true, comment: '主键' })
  id: string

  @Index('idx_user_id')
  @Column({ name: 'user_id', type: 'bigint', nullable: true, comment: '用户 ID（登录失败时可能为空）' })
  userId: string | null = null

  @Column({ type: 'varchar', length: 50, comment: '登录账号' })
  username: string

  @Column({ name: 'login_ip', type: 'varchar', length: 64, nullable: true, comment: '登录 IP' })
  loginIp: string | null = null

  @Column({ name: 'login_location', type: 'varchar', length: 100, nullable: true, comment: '登录地点' })
  loginLocation: string | null = null

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true, comment: '浏览器信息' })
  userAgent: string | null = null

  @Index('idx_login_result')
  @Column({ name: 'login_result', type: 'tinyint', comment: '登录结果：1=成功，0=失败' })
  loginResult: number

  @Index('idx_login_time')
  @Column({ name: 'login_time', type: 'datetime', comment: '登录时间' })
  loginTime: Date = new Date()
}
