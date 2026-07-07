import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PaginationParamsDto } from '@/common/dto/pagination-params.dto'

export class CreateTransportChannelDto {
  @ApiProperty({ description: '运输渠道名称' })
  @IsString()
  @IsNotEmpty({ message: '运输渠道名称不能为空' })
  channelName: string

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class UpdateTransportChannelDto {
  @ApiPropertyOptional({ description: '运输渠道名称' })
  @IsString()
  @IsOptional()
  channelName?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number

  @ApiPropertyOptional({ description: '备注' })
  @IsString()
  @IsOptional()
  remark?: string
}

export class QueryTransportChannelDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: '关键词' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '状态' })
  @IsIn([0, 1])
  @IsOptional()
  status?: number
}
