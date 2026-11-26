import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import { UnitOfWork } from '../../application/unit-of-work.js';
import {
  getCurrentTransactionClient,
  NestedTransactionError,
  runInTransactionContext,
} from './prisma-transaction-context.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaUnitOfWork extends UnitOfWork {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override run<T>(work: () => Promise<T>): Promise<T> {
    if (getCurrentTransactionClient()) {
      throw new NestedTransactionError();
    }

    return this.prisma.$transaction(
      (transaction) => runInTransactionContext(transaction, work),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }
}
