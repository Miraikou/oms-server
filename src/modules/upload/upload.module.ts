import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';

/**
 * 通用上传模块
 * 提供文件上传到 OSS 的统一接口
 */
@Module({
  controllers: [UploadController],
})
export class UploadModule {}
