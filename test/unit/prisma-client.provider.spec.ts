import { describe, expect, it, vi } from 'vitest';

import {
  ActiveTransactionRequiredError,
  PrismaClientProvider,
} from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

function createPrismaDouble(transaction: object) {
  const prisma = {
    $transaction: vi.fn(async (work: (current: object) => Promise<unknown>) =>
      work(transaction),
    ),
  };

  return prisma as unknown as PrismaService;
}

describe('PrismaClientProvider', () => {
  it('returns PrismaService from getClient outside a transaction', () => {
    const prisma = createPrismaDouble({ kind: 'transaction' });
    const provider = new PrismaClientProvider(prisma);

    expect(provider.getClient()).toBe(prisma);
  });

  it('returns the transactional client from getClient inside a transaction', async () => {
    const transaction = { kind: 'transaction' };
    const prisma = createPrismaDouble(transaction);
    const provider = new PrismaClientProvider(prisma);
    const unitOfWork = new PrismaUnitOfWork(prisma);

    await unitOfWork.run(async () => {
      expect(provider.getClient()).toBe(transaction);
    });
  });

  it('returns the transactional client from getTransactionClient when one is active', async () => {
    const transaction = { kind: 'transaction' };
    const prisma = createPrismaDouble(transaction);
    const provider = new PrismaClientProvider(prisma);
    const unitOfWork = new PrismaUnitOfWork(prisma);

    await unitOfWork.run(async () => {
      expect(provider.getTransactionClient()).toBe(transaction);
    });
  });

  it('throws ActiveTransactionRequiredError outside a transaction', () => {
    const prisma = createPrismaDouble({ kind: 'transaction' });
    const provider = new PrismaClientProvider(prisma);

    expect(() => provider.getTransactionClient()).toThrow(
      ActiveTransactionRequiredError,
    );
  });
});
