import { randomUUID } from 'node:crypto';

import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IdempotencyConflictError } from '#shared/application/idempotency-store.js';
import { Money } from '#shared/domain/value-objects/money.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaIdempotencyStore } from '#shared/infrastructure/prisma/prisma-idempotency-store.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';
import { NodeUuidGenerator } from '#shared/infrastructure/uuid/node-uuid-generator.js';

import { PrismaInstrumentQueries } from '#instruments/infrastructure/prisma/prisma-instrument-queries.js';
import { userId } from '#orders/application/types/user-id.js';
import {
  SubmitCashMovement,
  type SubmitCashMovementCommand,
} from '#orders/application/use-cases/submit-cash-movement.js';
import {
  SubmitTradeOrder,
  type SubmitTradeOrderCommand,
} from '#orders/application/use-cases/submit-trade-order.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { UnitPrice } from '#orders/domain/value-objects/unit-price.js';
import { PrismaAccountLock } from '#orders/infrastructure/prisma/prisma-account-lock.js';
import { PrismaAccountRepository } from '#orders/infrastructure/prisma/prisma-account-repository.js';
import { PrismaOrderRepository } from '#orders/infrastructure/prisma/prisma-order-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithLegacyDatabase =
  databaseUrl !== undefined && isLegacyTestDatabase(databaseUrl)
    ? describe
    : describe.skip;

describeWithLegacyDatabase('cash movements against PostgreSQL', () => {
  let prisma: PrismaService;
  let left: PrismaService;
  let right: PrismaService;
  let leftCash: SubmitCashMovement;
  let rightCash: SubmitCashMovement;
  let leftTrades: SubmitTradeOrder;
  let rightTrades: SubmitTradeOrder;
  const ownedUsers: string[] = [];
  const ownedAccounts: string[] = [];
  const ownedInstruments: string[] = [];
  const ownedQuotes: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl || !isLegacyTestDatabase(databaseUrl)) {
      throw new Error(
        'Refusing to use a database other than local cocos_legacy_test.',
      );
    }

    prisma = new PrismaService();
    left = new PrismaService();
    right = new PrismaService();
    await prisma.$connect();
    await left.$connect();
    await right.$connect();
    const connected = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;

    if (connected[0]?.name !== 'cocos_legacy_test') {
      throw new Error(
        `Refusing to use database ${connected[0]?.name ?? 'unknown'}.`,
      );
    }

    leftCash = cashUseCase(left);
    rightCash = cashUseCase(right);
    leftTrades = tradeUseCase(left);
    rightTrades = tradeUseCase(right);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup();
      await prisma.$disconnect();
    }

    await left?.$disconnect();
    await right?.$disconnect();
  });

  it('persists a cash in without changing an existing reserve', async () => {
    const owned = await createAccount();

    const deposit = await leftCash.execute(cash(owned, 'CASH_IN', '10000.00'));
    const limit = await leftTrades.execute(limitBuy(owned, 1n, 'reserve-100'));
    const extra = await rightCash.execute(cash(owned, 'CASH_IN', '500.00'));
    const stored = await accountState(owned.accountId);
    const row = await cashRow(deposit.id);

    expect(deposit.status).toBe('FILLED');
    expect(extra.status).toBe('FILLED');
    expect(limit.status).toBe('NEW');
    expect(row).toMatchObject({
      side: 'CASH_IN',
      price: null,
      type: null,
      status: 'FILLED',
      rejection_reason: null,
    });
    expect(sameMoney(stored.settledCash, '10500')).toBe(true);
    expect(sameMoney(stored.reservedCash, '100')).toBe(true);
    expect(stored.quantities).toEqual([]);
  });

  it('persists a filled cash out and a rejected cash out', async () => {
    const partial = await createAccount();
    await leftCash.execute(cash(partial, 'CASH_IN', '10000.00'));
    await leftTrades.execute(limitBuy(partial, 50n, 'reserve-5000'));

    const rejected = await leftCash.execute(
      cash(partial, 'CASH_OUT', '6000.00', 'out-6000'),
    );
    const replay = await rightCash.execute(
      cash(partial, 'CASH_OUT', '6000.00', 'out-6000'),
    );
    const smaller = await leftCash.execute(
      cash(partial, 'CASH_OUT', '3000.00'),
    );
    const afterPartial = await accountState(partial.accountId);

    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'INSUFFICIENT_CASH',
    });
    expect(replay).toEqual(rejected);
    expect(smaller.status).toBe('FILLED');
    expect(await cashRow(rejected.id)).toMatchObject({
      side: 'CASH_OUT',
      price: null,
      type: null,
      status: 'REJECTED',
      rejection_reason: 'INSUFFICIENT_CASH',
    });
    expect(sameMoney(afterPartial.settledCash, '7000')).toBe(true);
    expect(sameMoney(afterPartial.reservedCash, '5000')).toBe(true);
    expect(
      await prisma.order.count({
        where: { accountId: partial.accountId, side: 'CASH_OUT' },
      }),
    ).toBe(2);

    const exact = await createAccount();
    await leftCash.execute(cash(exact, 'CASH_IN', '10000.00'));
    await leftTrades.execute(limitBuy(exact, 50n, 'reserve-exact'));
    const filled = await leftCash.execute(cash(exact, 'CASH_OUT', '5000.00'));
    const afterExact = await accountState(exact.accountId);

    expect(filled.status).toBe('FILLED');
    expect(filled.rejectionReason).toBeNull();
    expect(sameMoney(afterExact.settledCash, '5000')).toBe(true);
    expect(sameMoney(afterExact.reservedCash, '5000')).toBe(true);
  });

  it('conflicts when the same key is reused for another amount', async () => {
    const owned = await createAccount();
    await leftCash.execute(cash(owned, 'CASH_IN', '100.00', 'shared-key'));

    await expect(
      rightCash.execute(cash(owned, 'CASH_IN', '200.00', 'shared-key')),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(
      await prisma.order.count({
        where: { accountId: owned.accountId, side: 'CASH_IN' },
      }),
    ).toBe(1);
  });

  it('does not accept both a cash out and a buy limit that need the same cash', async () => {
    const owned = await createAccount();
    await leftCash.execute(cash(owned, 'CASH_IN', '10000.00'));

    const [withdrawal, limit] = await Promise.all([
      leftCash.execute(cash(owned, 'CASH_OUT', '6000.00', 'race-out-limit')),
      rightTrades.execute(limitBuy(owned, 60n, 'race-limit')),
    ]);
    const stored = await accountState(owned.accountId);
    const accepted = [withdrawal.status, limit.status].filter(
      (status) => status === 'FILLED' || status === 'NEW',
    );

    expect(accepted).toHaveLength(1);

    if (withdrawal.status === 'FILLED') {
      expect(limit.status).toBe('REJECTED');
      expect(sameMoney(stored.settledCash, '4000')).toBe(true);
      expect(sameMoney(stored.reservedCash, '0')).toBe(true);
    } else {
      expect(limit.status).toBe('NEW');
      expect(withdrawal.rejectionReason).toBe('INSUFFICIENT_CASH');
      expect(sameMoney(stored.settledCash, '10000')).toBe(true);
      expect(sameMoney(stored.reservedCash, '6000')).toBe(true);
    }
  });

  it('does not settle both a cash out and a market buy that need the same cash', async () => {
    const owned = await createAccount();
    await leftCash.execute(cash(owned, 'CASH_IN', '10000.00'));

    const [withdrawal, market] = await Promise.all([
      leftCash.execute(cash(owned, 'CASH_OUT', '6000.00', 'race-out-market')),
      rightTrades.execute(marketBuy(owned, 60n, 'race-market')),
    ]);
    const stored = await accountState(owned.accountId);
    const filled = [withdrawal, market].filter(
      (order) => order.status === 'FILLED',
    );

    expect(filled).toHaveLength(1);
    expect(sameMoney(stored.settledCash, '4000')).toBe(true);
    expect(sameMoney(stored.reservedCash, '0')).toBe(true);
  });

  function cashUseCase(database: PrismaService): SubmitCashMovement {
    const parts = bind(database);

    return new SubmitCashMovement(
      parts.idempotency,
      parts.instruments,
      parts.unitOfWork,
      parts.accountLock,
      parts.orders,
      parts.ids,
      parts.accounts,
    );
  }

  function tradeUseCase(database: PrismaService): SubmitTradeOrder {
    const parts = bind(database);

    return new SubmitTradeOrder(
      parts.idempotency,
      parts.instruments,
      parts.unitOfWork,
      parts.accountLock,
      parts.orders,
      parts.ids,
      parts.accounts,
    );
  }

  async function createAccount(): Promise<{
    userId: string;
    accountId: string;
    instrumentId: string;
  }> {
    const owner = randomUUID();
    const ownedAccount = randomUUID();
    const stock = randomUUID();
    const quote = randomUUID();
    ownedUsers.push(owner);
    ownedAccounts.push(ownedAccount);
    ownedInstruments.push(stock);
    ownedQuotes.push(quote);

    await prisma.user.create({
      data: {
        id: owner,
        email: `cash-move-${owner}@test.local`,
        account: {
          create: {
            id: ownedAccount,
            accountNumber: `cash-move-${ownedAccount}`,
          },
        },
      },
    });
    await prisma.instrument.create({
      data: {
        id: stock,
        ticker: `C${owner.replaceAll('-', '').slice(0, 8)}`.toUpperCase(),
        name: 'Cash movement instrument',
        type: 'ACCIONES',
      },
    });
    await prisma.marketData.create({
      data: {
        id: quote,
        instrumentId: stock,
        high: '120.00',
        low: '80.00',
        open: '100.00',
        close: '100.00',
        previousClose: '90.00',
        observedAt: new Date(),
      },
    });

    return { userId: owner, accountId: ownedAccount, instrumentId: stock };
  }

  async function accountState(id: string): Promise<{
    settledCash: string;
    reservedCash: string;
    quantities: string[];
  }> {
    const rows = await prisma.$queryRaw<
      {
        reserved_cash: string;
        settled_cash: string;
        quantity: string | null;
      }[]
    >`
      SELECT
        accounts.reserved_cash::text AS reserved_cash,
        COALESCE((
          SELECT SUM(
            CASE
              WHEN orders.side = 'CASH_IN' AND orders.status = 'FILLED'
                THEN orders.size
              WHEN orders.side = 'CASH_OUT' AND orders.status = 'FILLED'
                THEN -orders.size
              WHEN orders.side = 'BUY'
                AND orders.type = 'MARKET'
                AND orders.status = 'FILLED'
                THEN -(orders.size * orders.price)
              WHEN orders.side = 'SELL'
                AND orders.type = 'MARKET'
                AND orders.status = 'FILLED'
                THEN orders.size * orders.price
              ELSE 0
            END
          )
          FROM orders
          WHERE orders.account_id = accounts.id
        ), 0)::text AS settled_cash,
        positions.quantity::text AS quantity
      FROM accounts
      LEFT JOIN account_reserved_positions AS positions
        ON positions.account_id = accounts.id
      WHERE accounts.id = ${id}::uuid
    `;

    return {
      reservedCash: rows[0]?.reserved_cash ?? '',
      settledCash: rows[0]?.settled_cash ?? '',
      quantities: rows.flatMap((row) =>
        row.quantity === null ? [] : [row.quantity],
      ),
    };
  }

  async function cashRow(id: string): Promise<{
    side: string;
    price: string | null;
    type: string | null;
    status: string;
    rejection_reason: string | null;
  }> {
    const rows = await prisma.$queryRaw<
      {
        side: string;
        price: string | null;
        type: string | null;
        status: string;
        rejection_reason: string | null;
      }[]
    >`
      SELECT
        side,
        price::text AS price,
        type,
        status,
        rejection_reason
      FROM orders
      WHERE id = ${id}::uuid
    `;
    const row = rows[0];

    if (!row) {
      throw new Error(`Cash movement ${id} was not persisted.`);
    }

    return row;
  }

  async function cleanup(): Promise<void> {
    if (ownedAccounts.length > 0) {
      await prisma.accountReservedPosition.deleteMany({
        where: { accountId: { in: ownedAccounts } },
      });
      await prisma.order.deleteMany({
        where: { accountId: { in: ownedAccounts } },
      });
      await prisma.account.deleteMany({
        where: { id: { in: ownedAccounts } },
      });
    }

    if (ownedUsers.length > 0) {
      await prisma.idempotencyRecord.deleteMany({
        where: { userId: { in: ownedUsers } },
      });
      await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } });
    }

    if (ownedQuotes.length > 0) {
      await prisma.marketData.deleteMany({
        where: { id: { in: ownedQuotes } },
      });
    }

    if (ownedInstruments.length > 0) {
      await prisma.instrument.deleteMany({
        where: { id: { in: ownedInstruments } },
      });
    }
  }
});

function bind(database: PrismaService) {
  const clients = new PrismaClientProvider(database);
  const ids = new NodeUuidGenerator();

  return {
    ids,
    idempotency: new PrismaIdempotencyStore(clients, ids),
    instruments: new PrismaInstrumentQueries(clients),
    unitOfWork: new PrismaUnitOfWork(database),
    accountLock: new PrismaAccountLock(clients),
    orders: new PrismaOrderRepository(clients),
    accounts: new PrismaAccountRepository(clients),
  };
}

function cash(
  owned: { userId: string },
  side: SubmitCashMovementCommand['side'],
  amount: string,
  idempotencyKey = `${side}-${amount}-${randomUUID()}`,
): SubmitCashMovementCommand {
  return {
    userId: userId(owned.userId),
    side,
    amount,
    idempotencyKey,
  };
}

function limitBuy(
  owned: { userId: string; instrumentId: string },
  quantity: bigint,
  idempotencyKey: string,
): SubmitTradeOrderCommand {
  return {
    userId: userId(owned.userId),
    instrumentId: instrumentId(owned.instrumentId),
    side: 'BUY',
    type: 'LIMIT',
    limitPrice: UnitPrice.parse('100'),
    idempotencyKey,
    sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(quantity) },
  };
}

function marketBuy(
  owned: { userId: string; instrumentId: string },
  quantity: bigint,
  idempotencyKey: string,
): SubmitTradeOrderCommand {
  return {
    userId: userId(owned.userId),
    instrumentId: instrumentId(owned.instrumentId),
    side: 'BUY',
    type: 'MARKET',
    idempotencyKey,
    sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(quantity) },
  };
}

function sameMoney(actual: string, expected: string): boolean {
  return Money.fromCalculation(actual).equals(Money.parse(expected));
}

function isLegacyTestDatabase(connectionString: string): boolean {
  const url = new URL(connectionString);
  const database = url.pathname.replace(/^\//, '').split('?')[0];
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';

  return local && database === 'cocos_legacy_test';
}
