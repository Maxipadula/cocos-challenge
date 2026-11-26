import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { UnitOfWork } from '../../src/shared/application/unit-of-work.js';
import { PrismaClientProvider } from '../../src/shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service.js';
import { PrismaUnitOfWork } from '../../src/shared/infrastructure/prisma/prisma-unit-of-work.js';

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
  });
});
