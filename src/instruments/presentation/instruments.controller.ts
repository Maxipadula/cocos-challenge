import { Controller, Get, Query } from '@nestjs/common';

import { SearchInstruments } from '../application/use-cases/search-instruments.js';
import { SearchInstrumentsQuery } from './search-instruments.query.js';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly searchInstruments: SearchInstruments) {}

  @Get()
  async search(@Query() query: SearchInstrumentsQuery) {
    return this.searchInstruments.execute(query.q, query.limit);
  }
}
