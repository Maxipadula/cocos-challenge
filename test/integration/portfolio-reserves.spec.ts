import { randomUUID } from 'node:crypto';

import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import { uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaIdempotencyStore } from '#shared/infrastructure/prisma/prisma-idempotency-store.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';
import { NodeUuidGenerator } from '#shared/infrastructure/uuid/node-uuid-generator.js';

import { PrismaInstrumentQueries } from '#instruments/infrastructure/prisma/prisma-instrument-queries.js';
import { userId } from '#orders/application/types/user-id.js';
import { CancelTradeOrder } from '#orders/application/use-cases/cancel-trade-order.js';
import { SubmitCashMovement } from '#orders/application/use-cases/submit-cash-movement.js';
import { SubmitTradeOrder } from '#orders/application/use-cases/submit-trade-order.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { orderId } from '#orders/domain/value-objects/order-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { UnitPrice } from '#orders/domain/value-objects/unit-price.js';
import { PrismaAccountLock } from '#orders/infrastructure/prisma/prisma-account-lock.js';
import { PrismaAccountRepository } from '#orders/infrastructure/prisma/prisma-account-repository.js';
import { PrismaOrderRepository } from '#orders/infrastructure/prisma/prisma-order-repository.js';
import { PrismaOrdersPortfolioData } from '#orders/infrastructure/prisma/prisma-orders-portfolio-data.js';
import { GetPortfolio } from '#portfolio/application/use-cases/get-portfolio.js';
import type { PortfolioPosition } from '#portfolio/domain/services/value-portfolio.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithLegacyDatabase =
  databaseUrl !== undefined && isLegacyTestDatabase(databaseUrl)
    ? describe
    : describe.skip;

describeWithLegacyDatabase('portfolio reserves against PostgreSQL', () => {
  let prisma: PrismaService;
  let portfolio: GetPortfolio;
  let cash: SubmitCashMovement;
  let trades: SubmitTradeOrder;
  let cancellations: CancelTradeOrder;
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
    await prisma.$connect();
    const connected = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;

    if (connected[0]?.name !== 'cocos_legacy_test') {
      throw new Error(
        `Refusing to use database ${connected[0]?.name ?? 'unknown'}.`,
      );
    }

    const clients = new PrismaClientProvider(prisma);
    const ids = new NodeUuidGenerator();
    const instruments = new PrismaInstrumentQueries(clients);
    const unitOfWork = new PrismaUnitOfWork(prisma);
    const accountLock = new PrismaAccountLock(clients);
    const orders = new PrismaOrderRepository(clients);
    const accounts = new PrismaAccountRepository(clients);
    const idempotency = new PrismaIdempotencyStore(clients, ids);
    portfolio = new GetPortfolio(
      new PrismaOrdersPortfolioData(clients),
      instruments,
    );
    cash = new SubmitCashMovement(
      idempotency,
      instruments,
      unitOfWork,
      accountLock,
      orders,
      ids,
      accounts,
    );
    trades = new SubmitTradeOrder(
      idempotency,
      instruments,
      unitOfWork,
      accountLock,
      orders,
      ids,
      accounts,
    );
    cancellations = new CancelTradeOrder(
      idempotency,
      unitOfWork,
      accountLock,
      orders,
      accounts,
    );
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    if (ownedAccounts.length > 0) {
      await prisma.accountReservedPosition.deleteMany({
        where: { accountId: { in: ownedAccounts } },
      });
      await prisma.order.deleteMany({
        where: { accountId: { in: ownedAccounts } },
      });
      await prisma.account.deleteMany({ where: { id: { in: ownedAccounts } } });
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

    await prisma.$disconnect();
  });

  it('reflects cash and share reserves and releases them on cancel', async () => {
    const owned = await createAccount();
    const caller = userId(owned.userId);

    await cash.execute(movement(owned, 'CASH_IN', '10000.00', 'deposit'));
    await expectCash(owned.userId, '10000', '0', '10000', '10000');

    const limit = await trades.execute({
      userId: caller,
      instrumentId: instrumentId(owned.instrumentId),
      side: 'BUY',
      type: 'LIMIT',
      limitPrice: UnitPrice.parse('100'),
      idempotencyKey: 'buy-limit',
      sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(60n) },
    });
    await expectCash(owned.userId, '10000', '6000', '4000', '10000');

    await cash.execute(movement(owned, 'CASH_IN', '500.00', 'extra-deposit'));
    await expectCash(owned.userId, '10500', '6000', '4500', '10500');

    await cancellations.execute({
      userId: caller,
      orderId: orderId(limit.id),
      idempotencyKey: 'cancel-buy-limit',
    });
    await expectCash(owned.userId, '10500', '0', '10500', '10500');

    await trades.execute({
      userId: caller,
      instrumentId: instrumentId(owned.instrumentId),
      side: 'BUY',
      type: 'MARKET',
      idempotencyKey: 'buy-market',
      sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(10n) },
    });
    const held = await read(owned.userId);
    expect(sameMoney(held.settledCash, '9500')).toBe(true);
    expect(holding(held, owned.ticker)).toMatchObject({
      quantity: '10',
      reservedQuantity: '0',
      availableQuantity: '10',
    });
    expect(
      sameMoney(holding(held, owned.ticker)?.marketValue ?? '', '1000'),
    ).toBe(true);
    expect(sameMoney(held.totalValue ?? '', '10500')).toBe(true);

    const sell = await trades.execute({
      userId: caller,
      instrumentId: instrumentId(owned.instrumentId),
      side: 'SELL',
      type: 'LIMIT',
      limitPrice: UnitPrice.parse('100'),
      idempotencyKey: 'sell-limit',
      sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(6n) },
    });
    const reserved = await read(owned.userId);
    expect(holding(reserved, owned.ticker)).toMatchObject({
      quantity: '10',
      reservedQuantity: '6',
      availableQuantity: '4',
    });
    expect(
      sameMoney(holding(reserved, owned.ticker)?.marketValue ?? '', '1000'),
    ).toBe(true);
    expect(sameMoney(reserved.reservedCash, '0')).toBe(true);
    expect(sameMoney(reserved.totalValue ?? '', '10500')).toBe(true);

    await cancellations.execute({
      userId: caller,
      orderId: orderId(sell.id),
      idempotencyKey: 'cancel-sell-limit',
    });
    expect(holding(await read(owned.userId), owned.ticker)).toMatchObject({
      quantity: '10',
      reservedQuantity: '0',
      availableQuantity: '10',
    });

    await cash.execute(movement(owned, 'CASH_OUT', '1000.00', 'withdrawal'));
    const afterWithdrawal = await read(owned.userId);
    expect(sameMoney(afterWithdrawal.settledCash, '8500')).toBe(true);
    expect(sameMoney(afterWithdrawal.reservedCash, '0')).toBe(true);
    expect(sameMoney(afterWithdrawal.availableCash, '8500')).toBe(true);
    expect(holding(afterWithdrawal, owned.ticker)?.reservedQuantity).toBe('0');
    expect(sameMoney(afterWithdrawal.totalValue ?? '', '9500')).toBe(true);
  });

  it('shows an instrument that exists only because of a share reserve', async () => {
    const owned = await createAccount();
    await prisma.accountReservedPosition.create({
      data: {
        accountId: owned.accountId,
        instrumentId: owned.instrumentId,
        quantity: '4',
      },
    });

    const loaded = await read(owned.userId);

    expect(holding(loaded, owned.ticker)).toMatchObject({
      quantity: '0',
      reservedQuantity: '4',
      availableQuantity: '0',
    });
    expect(
      sameMoney(holding(loaded, owned.ticker)?.marketValue ?? '', '0'),
    ).toBe(true);
    expect(sameMoney(loaded.totalValue ?? '', '0')).toBe(true);
  });

  async function expectCash(
    owner: string,
    settled: string,
    reserved: string,
    available: string,
    total: string,
  ): Promise<void> {
    const loaded = await read(owner);

    expect(sameMoney(loaded.settledCash, settled)).toBe(true);
    expect(sameMoney(loaded.reservedCash, reserved)).toBe(true);
    expect(sameMoney(loaded.availableCash, available)).toBe(true);
    expect(sameMoney(loaded.totalValue ?? '', total)).toBe(true);
    expect(loaded.positions).toEqual([]);
  }

  async function read(owner: string) {
    return portfolio.execute(uuid(owner));
  }

  async function createAccount(): Promise<{
    userId: string;
    accountId: string;
    instrumentId: string;
    ticker: string;
  }> {
    const owner = randomUUID();
    const ownedAccount = randomUUID();
    const stock = randomUUID();
    const quote = randomUUID();
    const ticker = `P${owner.replaceAll('-', '').slice(0, 8)}`.toUpperCase();
    ownedUsers.push(owner);
    ownedAccounts.push(ownedAccount);
    ownedInstruments.push(stock);
    ownedQuotes.push(quote);

    await prisma.user.create({
      data: {
        id: owner,
        email: `portfolio-reserve-${owner}@test.local`,
        account: {
          create: {
            id: ownedAccount,
            accountNumber: `portfolio-reserve-${ownedAccount}`,
          },
        },
      },
    });
    await prisma.instrument.create({
      data: {
        id: stock,
        ticker,
        name: 'Portfolio reserve instrument',
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

    return {
      userId: owner,
      accountId: ownedAccount,
      instrumentId: stock,
      ticker,
    };
  }
});

function movement(
  owned: { userId: string },
  side: 'CASH_IN' | 'CASH_OUT',
  amount: string,
  idempotencyKey: string,
) {
  return {
    userId: userId(owned.userId),
    side,
    amount,
    idempotencyKey,
  };
}

function holding(
  portfolio: { positions: readonly PortfolioPosition[] },
  ticker: string,
): PortfolioPosition | undefined {
  return portfolio.positions.find((position) => position.ticker === ticker);
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
