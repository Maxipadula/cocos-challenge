import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ErrorMessageResponse, InstrumentResponse } from '#docs/http-schemas.js';

import { SearchInstruments } from '../application/use-cases/search-instruments.js';
import { SearchInstrumentsQuery } from './search-instruments.query.js';

@ApiTags('instruments')
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly searchInstruments: SearchInstruments) {}

  @Get()
  @ApiOperation({
    summary: 'Search instruments',
    description:
      'Returns instruments whose ticker or name matches the term. Currency instruments (type MONEDA) are excluded. The term is trimmed and lowercased before the search.',
  })
  @ApiOkResponse({ type: InstrumentResponse, isArray: true })
  @ApiResponse({
    status: 400,
    description:
      'The query is missing, empty, longer than 64 characters, the limit is outside 1–50, or an unknown query field was sent.',
    type: ErrorMessageResponse,
  })
  @ApiResponse({ status: 500, description: 'Unexpected server error.', type: ErrorMessageResponse })
  async search(@Query() query: SearchInstrumentsQuery) {
    return this.searchInstruments.execute(query.q, query.limit);
  }
}
