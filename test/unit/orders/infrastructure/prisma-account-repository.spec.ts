import { describe, expect, it, vi } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import {
  ActiveTransactionRequiredError,
  PrismaClientProvider,
} from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { Account } from '#orders/domain/entities/account.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { AccountPersistenceError } from '#orders/infrastructure/prisma/account-persistence.error.js';
import { PrismaAccountRepository } from '#orders/infrastructure/prisma/prisma-account-repository.js';

import { Prisma } from '../../../../src/generated/prisma/client.js';
import { account, fixtureUuid, stock } from '../domain/order-fixture.js';

const other = instrumentId(fixtureUuid(21));
const largeQuantity = (2n ** 53n + 1n).toString();

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('?');
}

function statements(
  mock: ReturnType<typeof vi.fn>,
): { sql: string; params: unknown[] }[] {
  return mock.mock.calls.map((call) => ({
    sql: sqlText(call[0] as TemplateStringsArray),
    params: call.slice(1),
  }));
}

function createHarness() {
  const queryRaw = vi.fn();
  const executeRaw = vi.fn();
  const transaction = { $queryRaw: queryRaw, $executeRaw: executeRaw };
  const prisma = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
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
    executeRaw,
    getClient,
    getTransactionClient,
    unitOfWork: new PrismaUnitOfWork(prisma),
    repository: new PrismaAccountRepository(provider),
  };
}

describe('PrismaAccountRepository with a fake Prisma client', () => {
  it('reconstructs an account without reservations', async () => {
    const { queryRaw, getClient, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([
      {
        reserved_cash: new Prisma.Decimal('0'),
        reserved_positions: [],
      },
    ]);

    const loaded = await unitOfWork.run(() => repository.findById(account));

    expect(loaded?.reservedCash.isZero()).toBe(true);
    expect(loaded?.reservedSharePositions()).toEqual([]);
    expect(getClient).not.toHaveBeenCalled();
    expect(
      sqlText(queryRaw.mock.calls[0]?.[0] as TemplateStringsArray),
    ).toContain('reserved_cash');
  });

  it('reconstructs reserved cash', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([
      {
        reserved_cash: new Prisma.Decimal('125500.50'),
        reserved_positions: [],
      },
    ]);

    const loaded = await unitOfWork.run(() => repository.findById(account));

    expect(loaded?.reservedCash.equals(Money.parse('125500.50'))).toBe(true);
    expect(loaded?.reservedSharePositions()).toEqual([]);
  });

  it('reconstructs several share reservations', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([
      {
        reserved_cash: new Prisma.Decimal('0'),
        reserved_positions: [
          { instrument_id: stock, quantity: '5' },
          { instrument_id: other, quantity: '12' },
        ],
      },
    ]);

    const loaded = await unitOfWork.run(() => repository.findById(account));

    expect(loaded?.reservedSharesOf(stock)).toBe(5n);
    expect(loaded?.reservedSharesOf(other)).toBe(12n);
  });

  it('persists a reserved cash change as a decimal string', async () => {
    const { queryRaw, executeRaw, unitOfWork, repository } = createHarness();
    executeRaw.mockResolvedValue(1);
    queryRaw.mockResolvedValue([]);
    const reserved = Account.open(account).reserveCash(Money.parse('5000.25'));

    await unitOfWork.run(() => repository.save(reserved));

    const [update] = statements(executeRaw);

    expect(update?.sql).toContain('reserved_cash');
    expect(update?.params).toContain('5000.25');
    expect(
      update?.params.some((parameter) => typeof parameter === 'number'),
    ).toBe(false);
  });

  it('inserts a new share reservation', async () => {
    const { queryRaw, executeRaw, unitOfWork, repository } = createHarness();
    executeRaw.mockResolvedValue(1);
    queryRaw.mockResolvedValue([]);
    const reserved = Account.open(account).reserveShares(
      stock,
      ShareQuantity.of(4n),
    );

    await unitOfWork.run(() => repository.save(reserved));

    const insert = statements(executeRaw).find((statement) =>
      statement.sql.includes('INSERT'),
    );

    expect(insert?.params).toEqual([account, stock, '4']);
  });

  it('updates an existing share reservation', async () => {
    const { queryRaw, executeRaw, unitOfWork, repository } = createHarness();
    executeRaw.mockResolvedValue(1);
    queryRaw.mockResolvedValue([
      { instrument_id: stock, quantity: new Prisma.Decimal('4') },
    ]);
    const reserved = Account.open(account).reserveShares(
      stock,
      ShareQuantity.of(9n),
    );

    await unitOfWork.run(() => repository.save(reserved));

    const update = statements(executeRaw).find((statement) =>
      statement.sql.includes('SET quantity'),
    );

    expect(update?.params).toEqual(['9', account, stock]);
    expect(
      statements(executeRaw).some((statement) =>
        statement.sql.includes('INSERT'),
      ),
    ).toBe(false);
  });

  it('deletes a share reservation that reached zero', async () => {
    const { queryRaw, executeRaw, unitOfWork, repository } = createHarness();
    executeRaw.mockResolvedValue(1);
    queryRaw.mockResolvedValue([
      { instrument_id: stock, quantity: new Prisma.Decimal('4') },
    ]);

    await unitOfWork.run(() => repository.save(Account.open(account)));

    const deletion = statements(executeRaw).find((statement) =>
      statement.sql.includes('DELETE'),
    );

    expect(deletion?.params).toEqual([account, stock]);
    expect(
      statements(executeRaw).some((statement) =>
        statement.sql.includes('INSERT'),
      ),
    ).toBe(false);
  });

  it('keeps a large share quantity as a string', async () => {
    const { queryRaw, executeRaw, getClient, unitOfWork, repository } =
      createHarness();
    queryRaw.mockResolvedValueOnce([
      {
        reserved_cash: new Prisma.Decimal('0'),
        reserved_positions: [{ instrument_id: stock, quantity: largeQuantity }],
      },
    ]);

    const loaded = await unitOfWork.run(() => repository.findById(account));

    expect(loaded?.reservedSharesOf(stock).toString()).toBe(largeQuantity);
    executeRaw.mockResolvedValue(1);
    queryRaw.mockResolvedValueOnce([]);
    await unitOfWork.run(() =>
      repository.save(loaded ?? Account.open(account)),
    );

    const insert = statements(executeRaw).find((statement) =>
      statement.sql.includes('INSERT'),
    );

    expect(insert?.params).toContain(largeQuantity);
    expect(
      insert?.params.some((parameter) => typeof parameter === 'number'),
    ).toBe(false);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('rejects a write without an active transaction', async () => {
    const { queryRaw, executeRaw, getClient, repository } = createHarness();

    await expect(repository.save(Account.open(account))).rejects.toBeInstanceOf(
      ActiveTransactionRequiredError,
    );
    expect(executeRaw).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('rejects a missing account before changing positions', async () => {
    const { queryRaw, executeRaw, unitOfWork, repository } = createHarness();
    executeRaw.mockResolvedValue(0);

    await expect(
      unitOfWork.run(() => repository.save(Account.open(account))),
    ).rejects.toBeInstanceOf(AccountPersistenceError);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
