import { Injectable } from '@nestjs/common';
import {
  getCurrentTransactionClient,
  resolvePrismaClient,
  type PrismaExecutor,
  type PrismaTransactionClient,
} from './prisma-transaction-context.js';
import { PrismaService } from './prisma.service.js';

export class ActiveTransactionRequiredError extends Error {
  constructor() {
    super('An active transaction is required for this operation.');
    this.name = 'ActiveTransactionRequiredError';
  }
}

@Injectable()
export class PrismaClientProvider {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Client for queries that may run outside a transaction.
   * Inside UnitOfWork.run this is the transactional client.
   */
  getClient(): PrismaExecutor {
    return resolvePrismaClient(this.prisma);
  }

  /**
   * Client for writes and SELECT FOR UPDATE.
   * Mutating operations must run inside an active transaction.
   */
  getTransactionClient(): PrismaTransactionClient {
    const transaction = getCurrentTransactionClient();

    if (!transaction) {
      throw new ActiveTransactionRequiredError();
    }

    return transaction;
  }
}
