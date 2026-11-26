import { describe, expect, it, vi } from 'vitest';

import {
  ActiveTransactionRequiredError,
  PrismaClientProvider,
} from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { AccountNotFoundError } from '#orders/application/errors/account-not-found.error.js';
import { userId } from '#orders/application/types/user-id.js';
import { accountId } from '#orders/domain/value-objects/account-id.js';
import { PrismaAccountLock } from '#orders/infrastructure/prisma/prisma-account-lock.js';

import { fixtureUuid } from '../domain/order-fixture.js';

const caller = userId(fixtureUuid(7));
const account = fixtureUuid(3);

function sqlText(strings: TemplateStringsArray): string {
  return strings.join(' ');
}

function createHarness() {
  const queryRaw = vi.fn();
  const transaction = { $queryRaw: queryRaw };
  const prisma = {
    $transaction: vi.fn(
      async (work: (current: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    ),
  } as unknown as PrismaService;
  const provider = new PrismaClientProvider(prisma);
  const getClient = vi.spyOn(provider, 'getClient');
  const getTransactionClient = vi.spyOn(provider, 'getTransactionClient');

  return {
    queryRaw,
    provider,
    getClient,
    getTransactionClient,
    unitOfWork: new PrismaUnitOfWork(prisma),
    lock: new PrismaAccountLock(provider),
  };
}

describe('PrismaAccountLock', () => {
  it('returns the account id from the locked row', async () => {
    const { queryRaw, getClient, getTransactionClient, unitOfWork, lock } =
      createHarness();
    queryRaw.mockResolvedValue([{ id: account }]);

    const result = await unitOfWork.run(() => lock.acquireForUser(caller));

    expect(result).toBe(accountId(account));
    expect(getTransactionClient).toHaveBeenCalledOnce();
    expect(getClient).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledOnce();

    const [statement, parameter] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    const sql = sqlText(statement);

    expect(parameter).toBe(caller);
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('user_id');
    expect(sql).not.toContain(caller);
    expect(sql.toLowerCase()).not.toContain('insert');
  });

  it('throws AccountNotFoundError when the user has no account', async () => {
    const { queryRaw, unitOfWork, lock } = createHarness();
    queryRaw.mockResolvedValue([]);

    await expect(
      unitOfWork.run(() => lock.acquireForUser(caller)),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('propagates ActiveTransactionRequiredError outside a transaction', async () => {
    const { queryRaw, getClient, getTransactionClient, lock } = createHarness();

    await expect(lock.acquireForUser(caller)).rejects.toBeInstanceOf(
      ActiveTransactionRequiredError,
    );
    expect(getTransactionClient).toHaveBeenCalledOnce();
    expect(getClient).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
