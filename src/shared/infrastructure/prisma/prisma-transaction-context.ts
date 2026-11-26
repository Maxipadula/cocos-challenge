import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaService } from './prisma.service.js';

export type PrismaTransactionClient = Prisma.TransactionClient;

export type PrismaExecutor = PrismaService | PrismaTransactionClient;

const transactionStorage = new AsyncLocalStorage<PrismaTransactionClient>();

export class NestedTransactionError extends Error {
  constructor() {
    super(
      'A transaction is already active. Nested transactions are not supported.',
    );
    this.name = 'NestedTransactionError';
  }
}

export function runInTransactionContext<T>(
  transaction: PrismaTransactionClient,
  work: () => Promise<T>,
): Promise<T> {
  return transactionStorage.run(transaction, work);
}

export function getCurrentTransactionClient():
  PrismaTransactionClient | undefined {
  return transactionStorage.getStore();
}

export function resolvePrismaClient(prisma: PrismaService): PrismaExecutor {
  return getCurrentTransactionClient() ?? prisma;
}
