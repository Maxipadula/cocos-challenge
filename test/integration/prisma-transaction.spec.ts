import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaUnitOfWork } from '../../src/shared/infrastructure/prisma/prisma-unit-of-work.js';
import { resolvePrismaClient } from '../../src/shared/infrastructure/prisma/prisma-transaction-context.js';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service.js';

const describeWithDatabase = process.env.DATABASE_URL
  ? describe
  : describe.skip;

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
