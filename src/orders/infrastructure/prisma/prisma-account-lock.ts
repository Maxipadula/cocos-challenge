import { Injectable } from '@nestjs/common';

import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';

import { AccountNotFoundError } from '../../application/errors/account-not-found.error.js';
import { AccountLock } from '../../application/ports/account-lock.js';
import type { UserId } from '../../application/types/user-id.js';
import {
  accountId,
  type AccountId,
} from '../../domain/value-objects/account-id.js';

type AccountRow = {
  id: string;
};

@Injectable()
export class PrismaAccountLock extends AccountLock {
  constructor(private readonly clients: PrismaClientProvider) {
    super();
  }

  override async acquireForUser(userId: UserId): Promise<AccountId> {
    const client = this.clients.getTransactionClient();
    const rows = await client.$queryRaw<AccountRow[]>`
      SELECT id
      FROM accounts
      WHERE user_id = ${userId}::uuid
      FOR UPDATE
    `;
    const row = rows[0];

    if (!row) {
      throw new AccountNotFoundError();
    }

    return accountId(row.id);
  }
}
