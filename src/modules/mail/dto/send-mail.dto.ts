import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsEmail, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class AttachmentDto {
  @ApiProperty({ description: '附件文件名', example: 'report.pdf' })
  @IsString()
  filename: string;

  @ApiPropertyOptional({ description: '附件内容（Buffer 或字符串）', example: 'base64...' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '附件文件路径', example: '/tmp/report.pdf' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ description: '附件 MIME 类型', example: 'application/pdf' })
  @IsOptional()
  @IsString()
  contentType?: string;
}

export class SendMailDto {
  @ApiProperty({
    description: '收件人邮箱，支持单个字符串或字符串数组',
    example: 'user@example.com',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  @IsEmail({}, { each: true })
  to: string | string[];

  @ApiProperty({ description: '邮件主题', example: '欢迎注册' })
  @IsString()
  subject: string;

  @ApiPropertyOptional({ description: '纯文本内容', example: '欢迎加入我们' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({ description: 'HTML 内容', example: '<h1>欢迎</h1>' })
  @IsOptional()
  @IsString()
  html?: string;

  @ApiPropertyOptional({ description: '自定义发件人地址', example: 'noreply@example.com' })
  @IsOptional()
  @IsEmail()
  from?: string;

  @ApiPropertyOptional({
    description: '附件列表',
    type: [AttachmentDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}