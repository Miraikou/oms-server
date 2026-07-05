import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Between, Like } from 'typeorm'
import { SysLoginLog } from '../auth/entities/sys-login-log.entity'

/** 登录日志查询参数 */
interface LoginLogQuery {
  username?: string
  loginResult?: number
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

/**
 * 登录日志服务
 * 提供登录日志的分页查询和详情查看
 */
@Injectable()
export class LoginLogService {
  private readonly logger = new Logger(LoginLogService.name)

  constructor(
    @InjectRepository(SysLoginLog)
    private readonly loginLogRepo: Repository<SysLoginLog>,
  ) {}

  /**
   * 分页查询登录日志
   * @param query 查询参数
   */
  async findAll(query: LoginLogQuery) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20
    const qb = this.loginLogRepo.createQueryBuilder('log')

    // 条件过滤
    if (query.username) {
      qb.andWhere('log.username LIKE :username', { username: `%${query.username}%` })
    }
    if (query.loginResult !== undefined && query.loginResult !== null) {
      qb.andWhere('log.loginResult = :loginResult', { loginResult: query.loginResult })
    }
    if (query.startTime && query.endTime) {
      qb.andWhere('log.loginTime BETWEEN :startTime AND :endTime', {
        startTime: query.startTime,
        endTime: query.endTime,
      })
    } else if (query.startTime) {
      qb.andWhere('log.loginTime >= :startTime', { startTime: query.startTime })
    } else if (query.endTime) {
      qb.andWhere('log.loginTime <= :endTime', { endTime: query.endTime })
    }

    qb.orderBy('log.loginTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }

  /**
   * 查询单条登录日志详情
   * @param id 日志 ID
   */
  async findOne(id: string) {
    return this.loginLogRepo.findOne({ where: { id } })
  }
}
