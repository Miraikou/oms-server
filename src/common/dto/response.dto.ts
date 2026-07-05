import { ApiProperty } from '@nestjs/swagger';

/**
 * 统一 API 响应结构
 */
export class ApiResponseDto<T = unknown> {
  @ApiProperty({ description: '状态码，0 表示成功', example: 0 })
  code: number = 0;

  @ApiProperty({ description: '提示信息', example: 'success' })
  message: string = 'success';

  @ApiProperty({ description: '响应数据' })
  data: T | null = null;

  @ApiProperty({ description: '时间戳', example: 1783065600000 })
  timestamp: number = Date.now();
}

/**
 * 分页数据结构
 */
export class PaginatedDataDto<T> {
  @ApiProperty({ description: '数据列表', type: [Object] })
  list: T[] = [];

  @ApiProperty({ description: '总记录数', example: 100 })
  total: number = 0;

  @ApiProperty({ description: '当前页码', example: 1 })
  page: number = 1;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize: number = 20;
}
