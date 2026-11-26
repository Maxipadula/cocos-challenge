import { randomUUID } from 'node:crypto';

import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaIdempotencyStore } from '#shared/infrastructure/prisma/prisma-idempotency-store.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';
import { NodeUuidGenerator } from '#shared/infrastructure/uuid/node-uuid-generator.js';

import { PrismaInstrumentQueries } from '#instruments/infrastructure/prisma/prisma-instrument-queries.js';
import { userId } from '#orders/application/types/user-id.js';
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

describeWithLegacyDatabase('trade reservations against PostgreSQL', () => {
  let prisma: PrismaService;
  let left: PrismaService;
  let right: PrismaService;
  let leftOrders: SubmitTradeOrder;
  let rightOrders: SubmitTradeOrder;
  let arsId: string;
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

    const currency = await prisma.instrument.findUniqueOrThrow({
      where: { ticker: 'ARS' },
    });
    arsId = currency.id;
    leftOrders = submitter(left);
    rightOrders = submitter(right);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanup();
      await prisma.$disconnect();
    }

    await left?.$disconnect();
    await right?.$disconnect();
  });

  it('rejects a market buy in another session after a limit reserved the cash', async () => {
    const owned = await createAccount({ cash: '10000' });
    const limit = buy(owned, 'LIMIT', 60n, 'limit-6000');
    const market = buy(owned, 'MARKET', 50n, 'market-5000');

    const reserved = await leftOrders.execute(limit);
    const spent = await rightOrders.execute(market);
    const stored = await reservation(owned.accountId);

    expect(reserved.status).toBe('NEW');
    expect(spent.status).toBe('REJECTED');
    expect(spent.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(
      Money.fromCalculation(stored.reservedCash).equals(Money.parse('6000')),
    ).toBe(true);
    expect(
      Money.fromCalculation(stored.settledCash).equals(Money.parse('10000')),
    ).toBe(true);
    expect(stored.quantities).toEqual([]);
  });

  it('stops two concurrent buy limits from reserving more cash than is available', async () => {
    const owned = await createAccount({ cash: '10000' });
    const [first, second] = await Promise.all([
      leftOrders.execute(buy(owned, 'LIMIT', 60n, 'concurrent-limit-a')),
      rightOrders.execute(buy(owned, 'LIMIT', 60n, 'concurrent-limit-b')),
    ]);
    const stored = await reservation(owned.accountId);
    const accepted = [first, second].filter((order) => order.status === 'NEW');

    expect(accepted).toHaveLength(1);
    expect(
      [first, second].filter((order) => order.status === 'REJECTED'),
    ).toHaveLength(1);
    expect(
      Money.fromCalculation(stored.reservedCash).equals(Money.parse('6000')),
    ).toBe(true);
    expect(
      Money.fromCalculation(stored.settledCash).equals(Money.parse('10000')),
    ).toBe(true);
  });

  it('rejects a market sell in another session after a limit reserved the shares', async () => {
    const owned = await createAccount({ cash: '10000', shares: 10n });
    const limit = sell(owned, 'LIMIT', 6n, 'limit-6');
    const market = sell(owned, 'MARKET', 5n, 'market-5');

    const reserved = await leftOrders.execute(limit);
    const sold = await rightOrders.execute(market);
    const stored = await reservation(owned.accountId);

    expect(reserved.status).toBe('NEW');
    expect(sold.status).toBe('REJECTED');
    expect(sold.rejectionReason).toBe('INSUFFICIENT_SHARES');
    expect(stored.quantities).toEqual(['6']);
    expect(stored.settledShares).toBe('10');
  });

  it('stops two concurrent sells from consuming more shares than are available', async () => {
    const owned = await createAccount({ cash: '10000', shares: 10n });
    const [limit, market] = await Promise.all([
      leftOrders.execute(sell(owned, 'LIMIT', 6n, 'concurrent-sell-limit')),
      rightOrders.execute(sell(owned, 'MARKET', 5n, 'concurrent-sell-market')),
    ]);
    const stored = await reservation(owned.accountId);
    const rejected = [limit, market].filter(
      (order) => order.status === 'REJECTED',
    );

    expect(rejected).toHaveLength(1);

    if (market.status === 'FILLED') {
      expect(limit.status).toBe('REJECTED');
      expect(stored.quantities).toEqual([]);
      expect(stored.settledShares).toBe('5');
    } else {
      expect(limit.status).toBe('NEW');
      expect(market.rejectionReason).toBe('INSUFFICIENT_SHARES');
      expect(stored.quantities).toEqual(['6']);
      expect(stored.settledShares).toBe('10');
    }
  });

  it('replays a limit buy without reserving the cash twice', async () => {
    const owned = await createAccount({ cash: '1000' });
    const command = buy(owned, 'LIMIT', 2n, 'replay-limit');

    const first = await leftOrders.execute(command);
    const replay = await rightOrders.execute(command);
    const stored = await reservation(owned.accountId);
    const orders = await prisma.order.count({
      where: { accountId: owned.accountId, side: 'BUY' },
    });

    expect(first.status).toBe('NEW');
    expect(replay).toEqual(first);
    expect(orders).toBe(1);
    expect(
      Money.fromCalculation(stored.reservedCash).equals(Money.parse('200')),
    ).toBe(true);
  });

  it('leaves the seeded Emiliano reservations unchanged', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'emiliano@test.com' },
      include: { account: true },
    });
    const stored = await reservation(user.account?.id ?? '');

    expect(
      Money.fromCalculation(stored.reservedCash).equals(Money.parse('125500')),
    ).toBe(true);
    expect(stored.quantities).toEqual([]);
  });

  function submitter(database: PrismaService): SubmitTradeOrder {
    const clients = new PrismaClientProvider(database);
    const ids = new NodeUuidGenerator();

    return new SubmitTradeOrder(
      new PrismaIdempotencyStore(clients, ids),
      new PrismaInstrumentQueries(clients),
      new PrismaUnitOfWork(database),
      new PrismaAccountLock(clients),
      new PrismaOrderRepository(clients),
      ids,
      new PrismaAccountRepository(clients),
    );
  }

  async function createAccount(input: {
    cash: string;
    shares?: bigint;
  }): Promise<{ userId: string; accountId: string; instrumentId: string }> {
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
        email: `trade-reserve-${owner}@test.local`,
        account: {
          create: {
            id: ownedAccount,
            accountNumber: `trade-reserve-${ownedAccount}`,
          },
        },
      },
    });
    await prisma.instrument.create({
      data: {
        id: stock,
        ticker: `T${owner.replaceAll('-', '').slice(0, 8)}`.toUpperCase(),
        name: 'Trade reservation instrument',
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
    await prisma.order.create({
      data: {
        id: randomUUID(),
        accountId: ownedAccount,
        instrumentId: arsId,
        side: 'CASH_IN',
        size: input.cash,
        status: 'FILLED',
        placedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    if (input.shares !== undefined) {
      await prisma.order.create({
        data: {
          id: randomUUID(),
          accountId: ownedAccount,
          instrumentId: stock,
          side: 'BUY',
          type: 'MARKET',
          size: input.shares.toString(),
          price: '100.00',
          status: 'FILLED',
          placedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      });
    }

    return { userId: owner, accountId: ownedAccount, instrumentId: stock };
  }

  async function reservation(id: string): Promise<{
    reservedCash: string;
    settledCash: string;
    settledShares: string;
    quantities: string[];
  }> {
    const rows = await prisma.$queryRaw<
      {
        reserved_cash: string;
        settled_cash: string;
        settled_shares: string;
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
          COALESCE((
            SELECT SUM(
              CASE
                WHEN orders.side = 'BUY'
                  AND orders.type = 'MARKET'
                  AND orders.status = 'FILLED'
                  THEN orders.size
                WHEN orders.side = 'SELL'
                  AND orders.type = 'MARKET'
                  AND orders.status = 'FILLED'
                  THEN -orders.size
                ELSE 0
              END
            )
            FROM orders
            WHERE orders.account_id = accounts.id
          ), 0)::text AS settled_shares,
          positions.quantity::text AS quantity
        FROM accounts
        LEFT JOIN account_reserved_positions AS positions
          ON positions.account_id = accounts.id
        WHERE accounts.id = ${id}::uuid
        ORDER BY positions.instrument_id
      `;

    return {
      reservedCash: rows[0]?.reserved_cash ?? '',
      settledCash: rows[0]?.settled_cash ?? '',
      settledShares: whole(rows[0]?.settled_shares ?? '0'),
      quantities: rows.flatMap((row) =>
        row.quantity === null ? [] : [whole(row.quantity)],
      ),
    };
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

function buy(
  owned: { userId: string; instrumentId: string },
  type: 'MARKET' | 'LIMIT',
  quantity: bigint,
  idempotencyKey: string,
): SubmitTradeOrderCommand {
  const base = {
    userId: userId(owned.userId),
    instrumentId: instrumentId(owned.instrumentId),
    side: 'BUY' as const,
    idempotencyKey,
    sizing: {
      kind: 'QUANTITY' as const,
      quantity: ShareQuantity.of(quantity),
    },
  };

  return type === 'MARKET'
    ? { ...base, type: 'MARKET' }
    : { ...base, type: 'LIMIT', limitPrice: UnitPrice.parse('100') };
}

function sell(
  owned: { userId: string; instrumentId: string },
  type: 'MARKET' | 'LIMIT',
  quantity: bigint,
  idempotencyKey: string,
): SubmitTradeOrderCommand {
  const base = {
    userId: userId(owned.userId),
    instrumentId: instrumentId(owned.instrumentId),
    side: 'SELL' as const,
    idempotencyKey,
    sizing: {
      kind: 'QUANTITY' as const,
      quantity: ShareQuantity.of(quantity),
    },
  };

  return type === 'MARKET'
    ? { ...base, type: 'MARKET' }
    : { ...base, type: 'LIMIT', limitPrice: UnitPrice.parse('100') };
}

function whole(value: string): string {
  const [digits, fraction] = value.split('.');

  if (fraction !== undefined && !/^0*$/.test(fraction)) {
    throw new Error(`Expected a whole quantity, received ${value}.`);
  }

  return (digits ?? '0').replace(/^0+(?=\d)/, '') || '0';
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
