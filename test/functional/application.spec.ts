import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '#shared/application/unit-of-work.js';
import { UuidGenerator } from '#shared/application/uuid-generator.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';
import { NodeUuidGenerator } from '#shared/infrastructure/uuid/node-uuid-generator.js';

import { AccountLock } from '#orders/application/ports/account-lock.js';
import { PrismaAccountLock } from '#orders/infrastructure/prisma/prisma-account-lock.js';

import { AppModule } from '../../src/app.module.js';

describe('application bootstrap', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: async () => undefined,
        $disconnect: async () => undefined,
        $transaction: async () => undefined,
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('starts and exposes the Prisma unit of work', () => {
    expect(app.get(UnitOfWork)).toBeInstanceOf(PrismaUnitOfWork);
    expect(app.get(PrismaClientProvider)).toBeInstanceOf(PrismaClientProvider);
    expect(app.get(UuidGenerator)).toBeInstanceOf(NodeUuidGenerator);
    expect(app.get(AccountLock)).toBeInstanceOf(PrismaAccountLock);
  });
});
