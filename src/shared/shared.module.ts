import { Module } from '@nestjs/common';

import { IdempotencyStore } from './application/idempotency-store.js';
import { UuidGenerator } from './application/uuid-generator.js';
import { PrismaIdempotencyStore } from './infrastructure/prisma/prisma-idempotency-store.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { NodeUuidGenerator } from './infrastructure/uuid/node-uuid-generator.js';

@Module({
  imports: [PrismaModule],
  providers: [
    NodeUuidGenerator,
    { provide: UuidGenerator, useExisting: NodeUuidGenerator },
    PrismaIdempotencyStore,
    { provide: IdempotencyStore, useExisting: PrismaIdempotencyStore },
  ],
  exports: [PrismaModule, UuidGenerator, IdempotencyStore],
})
export class SharedModule {}
