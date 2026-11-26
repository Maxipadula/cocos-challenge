import { describe, expect, it, vi } from 'vitest';

import {
  NestedTransactionError,
  resolvePrismaClient,
} from '#shared/infrastructure/prisma/prisma-transaction-context.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { Prisma } from '../../src/generated/prisma/client.js';

type TransactionOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

function createPrismaDouble(transaction: object) {
  const calls: TransactionOptions[] = [];
  let committed = false;

  const prisma = {
    $transaction: vi.fn(
      async (
        work: (current: object) => Promise<unknown>,
        options?: TransactionOptions,
      ) => {
        calls.push(options ?? {});

        try {
          const result = await work(transaction);
          committed = true;
          return result;
        } catch (error) {
          committed = false;
          throw error;
        }
      },
    ),
  };

  return {
    calls,
    isCommitted: () => committed,
    prisma: prisma as unknown as PrismaService,
  };
}

describe('PrismaUnitOfWork', () => {
  it('runs the callback with the transactional client and Read Committed isolation', async () => {
    const transaction = { kind: 'transaction' };
    const database = createPrismaDouble(transaction);
    const unitOfWork = new PrismaUnitOfWork(database.prisma);
    let clientDuringWork: unknown;

    const result = await unitOfWork.run(async () => {
      clientDuringWork = resolvePrismaClient(database.prisma);
      return 'done';
    });

    expect(result).toBe('done');
    expect(clientDuringWork).toBe(transaction);
    expect(resolvePrismaClient(database.prisma)).toBe(database.prisma);
    expect(database.isCommitted()).toBe(true);
    expect(database.calls).toEqual([
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    ]);
  });

  it('rejects and leaves the transaction uncommitted when the callback throws', async () => {
    const database = createPrismaDouble({ kind: 'transaction' });
    const unitOfWork = new PrismaUnitOfWork(database.prisma);

    await expect(
      unitOfWork.run(async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');

    expect(database.isCommitted()).toBe(false);
    expect(resolvePrismaClient(database.prisma)).toBe(database.prisma);
  });

  it('refuses to open a second transaction while one is active', async () => {
    const database = createPrismaDouble({ kind: 'transaction' });
    const unitOfWork = new PrismaUnitOfWork(database.prisma);

    await expect(
      unitOfWork.run(async () => {
        await unitOfWork.run(async () => undefined);
      }),
    ).rejects.toBeInstanceOf(NestedTransactionError);

    expect(database.isCommitted()).toBe(false);
    expect(database.calls).toHaveLength(1);
    expect(resolvePrismaClient(database.prisma)).toBe(database.prisma);
  });
});
