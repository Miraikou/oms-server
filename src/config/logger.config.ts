import { utilities as nestWinstonModuleUtilities } from 'nest-winston'
import * as winston from 'winston'

/**
 * Winston 日志配置
 * - 开发环境：控制台彩色输出 + 文件输出
 * - 生产环境：JSON 格式 + 文件轮转
 */
export const loggerConfig = {
  transports: [
    // 控制台输出（开发友好格式）
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.ms(),
        nestWinstonModuleUtilities.format.nestLike('OMS', {
          prettyPrint: true,
          colors: true,
        }),
      ),
    }),
    // 文件输出（所有级别）
    new winston.transports.File({
      filename: 'logs/app.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // 文件输出（仅错误级别）
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
}
