import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsNumberString,
} from 'class-validator';

/** 创建汇率 DTO */
export class CreateExchangeRateDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{1,10}$/, { message: 'fromCurrency 必须为大写字母' })
  fromCurrency: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{1,10}$/, { message: 'toCurrency 必须为大写字母' })
  toCurrency?: string;

  @IsNumberString({}, { message: 'rate 必须为数字' })
  @IsNotEmpty()
  rate: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveDate 格式必须为 YYYY-MM-DD' })
  effectiveDate: string;
}

/** 更新汇率 DTO（部分更新，所有字段可选） */
export class UpdateExchangeRateDto {
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{1,10}$/, { message: 'fromCurrency 必须为大写字母' })
  fromCurrency?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Z]{1,10}$/, { message: 'toCurrency 必须为大写字母' })
  toCurrency?: string;

  @IsNumberString({}, { message: 'rate 必须为数字' })
  @IsOptional()
  rate?: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveDate 格式必须为 YYYY-MM-DD' })
  effectiveDate?: string;
}

/** 查询汇率列表 DTO */
export class QueryExchangeRateDto {
  @IsOptional()
  @IsString()
  fromCurrency?: string;

  @IsOptional()
  @IsString()
  toCurrency?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @IsOptional()
  page?: number;

  @IsOptional()
  pageSize?: number;
}

/** 同步汇率 DTO */
export class SyncExchangeRateDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate 格式必须为 YYYY-MM-DD' })
  startDate: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate 格式必须为 YYYY-MM-DD' })
  endDate: string;

  @IsOptional()
  @IsString()
  base?: string;
}
