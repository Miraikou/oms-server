import { DataSource } from 'typeorm'
import * as dotenv from 'dotenv'

dotenv.config()

/**
 * TypeORM CLI 数据源配置
 * 用于执行 Migration 命令（生成、运行、回滚）
 *
 * 使用方式：
 * - 生成迁移：npx typeorm-ts-node-commonjs migration:generate -d src/database.config.ts src/migrations/init
 * - 执行迁移：npx typeorm-ts-node-commonjs migration:run -d src/database.config.ts
 * - 回滚迁移：npx typeorm-ts-node-commonjs migration:revert -d src/database.config.ts
 */
export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'oms',
  charset: 'utf8mb4',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: true,
  bigNumberStrings: true,
})
