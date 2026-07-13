import {
  Controller,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OssService } from '@/common/oss/oss.service';

/**
 * 通用上传控制器
 * 提供文件上传到阿里云 OSS 的统一入口
 */
@ApiTags('通用上传')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly ossService: OssService) {}

  @Post('image')
  @ApiOperation({ summary: '上传图片到 OSS' })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'folder', description: 'OSS 存储目录', example: 'products' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string },
    @Query('folder') folder: string = 'common',
  ) {
    if (!file) {
      throw new BadRequestException('未收到文件，请检查表单字段名为 file')
    }

    // MIME 类型白名单
    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'image/bmp', 'image/svg+xml',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(`不支持的文件类型: ${file.mimetype}`);
    }

    // 路径安全：防止目录遍历
    const sanitizedFolder = folder.replace(/[^\w\-/]/g, '').replace(/\.\./g, '');
    if (!sanitizedFolder || sanitizedFolder.startsWith('/') || sanitizedFolder.includes('..')) {
      throw new BadRequestException('无效的存储目录');
    }

    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const objectName = `${sanitizedFolder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_filename_${filename}`
    const url = await this.ossService.upload(file.buffer, objectName)
    return { url }
  }
}
