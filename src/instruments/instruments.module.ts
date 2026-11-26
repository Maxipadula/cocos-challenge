import { Module } from '@nestjs/common';

import { SharedModule } from '#shared/shared.module.js';

import { InstrumentQueries } from './application/instrument-queries.js';
import { PrismaInstrumentQueries } from './infrastructure/prisma/prisma-instrument-queries.js';

@Module({
  imports: [SharedModule],
  providers: [
    PrismaInstrumentQueries,
    { provide: InstrumentQueries, useExisting: PrismaInstrumentQueries },
  ],
  exports: [InstrumentQueries],
})
export class InstrumentsModule {}
