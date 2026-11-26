import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { MAX_SEARCH_LIMIT } from '../application/use-cases/search-instruments.js';

export class SearchInstrumentsQuery {
  @ApiProperty({
    example: 'ggal',
    description:
      'Ticker or name fragment. It is trimmed and lowercased. Empty values and terms longer than 64 characters are rejected.',
  })
  @IsString()
  @IsNotEmpty()
  q: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_SEARCH_LIMIT,
    default: 20,
    example: 20,
    description: 'Maximum number of instruments to return. Defaults to 20.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_LIMIT)
  limit?: number;
}
