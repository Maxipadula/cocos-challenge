import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import { uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { PrismaInstrumentQueries } from '#instruments/infrastructure/prisma/prisma-instrument-queries.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import { accountId } from '#orders/domain/value-objects/account-id.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { orderId } from '#orders/domain/value-objects/order-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { UnitPrice } from '#orders/domain/value-objects/unit-price.js';
import { PrismaOrdersPortfolioData } from '#orders/infrastructure/prisma/prisma-orders-portfolio-data.js';
import { GetPortfolio } from '#portfolio/application/use-cases/get-portfolio.js';

import { seedDevelopmentDatabase } from '../../src/seed/development-seed.js';
import { challengeFixtureId } from '../../src/seed/fixture-id.js';

const databaseUrl = process.env.DATABASE_URL;
const localDatabase = databaseUrl ? isLocalDatabase(databaseUrl) : false;
const describeWithLocalDatabase =
  databaseUrl && localDatabase ? describe : describe.skip;

describeWithLocalDatabase('seeded challenge portfolio', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    await seedDevelopmentDatabase(databaseUrl ?? '');
    await seedDevelopmentDatabase(databaseUrl ?? '');
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('values Emiliano from the seeded orders and the latest quotes', async () => {
    const loaded = await load('emiliano@test.com');

    expect(loaded.snapshot).not.toBeNull();
    expect(money(loaded.portfolio.settledCash, '783800')).toBe(true);
    expect(money(loaded.snapshot?.committedCash ?? '', '125500')).toBe(true);
    expect(money(loaded.portfolio.availableCash, '658300')).toBe(true);
    expect(money(loaded.portfolio.totalValue ?? '', '890500')).toBe(true);
    expect(position(loaded.portfolio.positions, 'PAMP')).toBe('40');
    expect(position(loaded.portfolio.positions, 'METR')).toBe('500');
    expect(position(loaded.portfolio.positions, 'BMA')).toBe('-30');
    expect(
      loaded.portfolio.positions.some((item) => item.ticker === 'LOMA'),
    ).toBe(false);
    expect(await committedLimit('BMA')).toBe(true);
    expect(await committedLimit('LOMA')).toBe(true);
    expect(
      await prisma.order.findUnique({
        where: { id: challengeFixtureId('order', 9) },
      }),
    ).toBeNull();
  });

  it('gives the other three users an empty portfolio', async () => {
    for (const email of [
      'jose@test.com',
      'francisco@test.com',
      'juan@test.com',
    ]) {
      const loaded = await load(email);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email },
        include: { account: { include: { orders: true } } },
      });

      expect(user.account?.orders).toEqual([]);
      expect(money(loaded.portfolio.settledCash, '0')).toBe(true);
      expect(loaded.snapshot).not.toBeNull();
      expect(money(loaded.snapshot?.committedCash ?? '', '0')).toBe(true);
      expect(money(loaded.portfolio.availableCash, '0')).toBe(true);
      expect(money(loaded.portfolio.totalValue ?? '', '0')).toBe(true);
      expect(loaded.portfolio.positions).toEqual([]);
    }
  });

  async function load(email: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const clients = new PrismaClientProvider(prisma);
    const orders = new PrismaOrdersPortfolioData(clients);
    const userId = uuid(user.id);

    return {
      snapshot: await orders.findByUserId(userId),
      portfolio: await new GetPortfolio(
        orders,
        new PrismaInstrumentQueries(clients),
      ).execute(userId),
    };
  }

  async function committedLimit(ticker: string): Promise<boolean> {
    const rows = await prisma.order.findMany({
      where: {
        status: 'NEW',
        type: 'LIMIT',
        side: 'BUY',
        instrument: { ticker },
        account: { user: { email: 'emiliano@test.com' } },
      },
    });
    const order = rows[0];

    if (!order || rows.length !== 1 || order.price === null) {
      return false;
    }

    const committed = TradeOrder.limitOpen({
      id: orderId(order.id),
      accountId: accountId(order.accountId),
      instrumentId: instrumentId(order.instrumentId),
      side: 'BUY',
      size: ShareQuantity.of(BigInt(order.size.toFixed(0))),
      placedAt: order.placedAt,
      price: UnitPrice.parse(order.price.toFixed()),
    }).committedCash();
    const expected = ticker === 'BMA' ? '90000' : '35500';

    return committed.equals(Money.parse(expected));
  }
});

function money(actual: string, expected: string): boolean {
  return Money.fromCalculation(actual).equals(Money.parse(expected));
}

function position(
  positions: ReadonlyArray<{ ticker: string; quantity: string }>,
  ticker: string,
): string | undefined {
  return positions.find((item) => item.ticker === ticker)?.quantity;
}

function isLocalDatabase(connectionString: string): boolean {
  const host = new URL(connectionString).hostname;

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
