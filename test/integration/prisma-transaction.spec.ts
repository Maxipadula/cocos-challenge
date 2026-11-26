import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolvePrismaClient } from '#shared/infrastructure/prisma/prisma-transaction-context.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase =
  databaseUrl && isLocalDatabase(databaseUrl) ? describe : describe.skip;

describeWithDatabase('PrismaUnitOfWork against PostgreSQL', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs a parameterized statement on the transactional client and rolls it back', async () => {
    const unitOfWork = new PrismaUnitOfWork(prisma);

    await expect(
      unitOfWork.run(async () => {
        const client = resolvePrismaClient(prisma);
        await client.$executeRaw`CREATE TEMP TABLE rollback_probe (id int)`;
        await client.$executeRaw`INSERT INTO rollback_probe (id) VALUES (${1})`;
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    await expect(
      prisma.$queryRaw`SELECT id FROM rollback_probe`,
    ).rejects.toThrow();
  });
});

function isLocalDatabase(connectionString: string): boolean {
  const host = new URL(connectionString).hostname;

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
