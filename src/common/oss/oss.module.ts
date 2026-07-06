import { Global, Module } from '@nestjs/common'
import { OssService } from './oss.service'

/**
 * OSS 全局模块
 * 提供阿里云 OSS 文件上传/删除服务
 */
@Global()
@Module({
  providers: [OssService],
  exports: [OssService],
})
export class OssModule {}
