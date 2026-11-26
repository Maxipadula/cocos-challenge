import { Module } from '@nestjs/common';

import { SharedModule } from '#shared/shared.module.js';

import { InstrumentQueries } from './application/instrument-queries.js';
import { SearchInstruments } from './application/use-cases/search-instruments.js';
import { PrismaInstrumentQueries } from './infrastructure/prisma/prisma-instrument-queries.js';
import { InstrumentsController } from './presentation/instruments.controller.js';

@Module({
  imports: [SharedModule],
  controllers: [InstrumentsController],
  providers: [
    PrismaInstrumentQueries,
    { provide: InstrumentQueries, useExisting: PrismaInstrumentQueries },
    {
      provide: SearchInstruments,
      useFactory: (instruments: InstrumentQueries) =>
        new SearchInstruments(instruments),
      inject: [InstrumentQueries],
    },
  ],
  exports: [InstrumentQueries],
})
export class InstrumentsModule {}
