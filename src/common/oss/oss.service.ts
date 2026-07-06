import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OSS from 'ali-oss'

/**
 * 阿里云 OSS 服务
 * 提供文件上传、删除等基础操作
 */
@Injectable()
export class OssService {
  private readonly logger = new Logger(OssService.name)
  private readonly client: OSS

  constructor(private readonly configService: ConfigService) {
    this.client = new OSS({
      accessKeyId: this.configService.get<string>('ALI_OSS_AK', ''),
      accessKeySecret: this.configService.get<string>('ALI_OSS_SK', ''),
      endpoint: this.configService.get<string>('ALI_OSS_ENDPOINT', ''),
      bucket: this.configService.get<string>('ALI_OSS_BUCKET', ''),
    })
  }

  /**
   * 上传文件到 OSS
   * @param file Buffer 或本地路径
   * @param objectName OSS 对象名（如 products/2024/abc123.jpg）
   * @returns 文件公网访问 URL
   */
  async upload(file: Buffer | string, objectName: string): Promise<string> {
    const result = await this.client.put(objectName, file)
    return result.url
  }

  /**
   * 从 OSS 删除文件
   * @param objectName OSS 对象名
   */
  async delete(objectName: string): Promise<void> {
    try {
      await this.client.delete(objectName)
    } catch (error) {
      this.logger.warn(`删除 OSS 文件失败: ${objectName}`, error instanceof Error ? error.message : error)
    }
  }

  /**
   * 从完整 URL 中提取 OSS 对象名
   * @param url OSS 文件 URL
   * @returns 对象名，如 products/2024/abc123.jpg
   */
  extractObjectName(url: string): string | null {
    try {
      const parsed = new URL(url)
      // OSS URL 格式: https://bucket.endpoint/objectName
      // 去掉开头的 /
      return parsed.pathname.replace(/^\//, '')
    } catch {
      return null
    }
  }
}
