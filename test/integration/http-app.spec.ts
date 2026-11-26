import { randomUUID } from 'node:crypto';

import 'dotenv/config';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { AppModule } from '../../src/app.module.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithLocalDatabase =
  databaseUrl && isLocalDatabase(databaseUrl) ? describe : describe.skip;

describeWithLocalDatabase('HTTP application against PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let arsId: string;
  let createdArs = false;
  const owned = {
    users: [] as string[],
    accounts: [] as string[],
    instruments: [] as string[],
    quotes: [] as string[],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
    const existing = await prisma.instrument.findUnique({
      where: { ticker: 'ARS' },
    });

    if (existing) {
      arsId = existing.id;
      return;
    }

    arsId = randomUUID();
    createdArs = true;
    await prisma.instrument.create({
      data: {
        id: arsId,
        ticker: 'ARS',
        name: 'PESOS',
        type: 'MONEDA',
      },
    });
  });

  beforeEach(() => {
    owned.users = [];
    owned.accounts = [];
    owned.instruments = [];
    owned.quotes = [];
  });

  afterEach(async () => {
    await prisma.idempotencyRecord.deleteMany({
      where: { userId: { in: owned.users } },
    });
    await prisma.accountReservedPosition.deleteMany({
      where: { accountId: { in: owned.accounts } },
    });
    await prisma.order.deleteMany({
      where: { accountId: { in: owned.accounts } },
    });
    await prisma.marketData.deleteMany({
      where: { id: { in: owned.quotes } },
    });
    await prisma.account.deleteMany({
      where: { id: { in: owned.accounts } },
    });
    await prisma.instrument.deleteMany({
      where: { id: { in: owned.instruments } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: owned.users } },
    });
  });

  afterAll(async () => {
    if (createdArs) {
      await prisma.instrument.delete({ where: { id: arsId } }).catch(() => undefined);
    }

    await app?.close();
  });

  it('searches by ticker and name and hides currency instruments', async () => {
    const suffix = randomUUID().slice(0, 8);
    const ticker = `HX${suffix}`.toUpperCase();
    const name = `Http Searchable ${suffix}`;
    const currency = `HM${suffix}`.toUpperCase();
    const stock = await createInstrument({
      ticker,
      name,
      type: 'ACCIONES',
    });
    await createInstrument({
      ticker: currency,
      name: `Http Currency ${suffix}`,
      type: 'MONEDA',
    });

    const byTicker = await request(app.getHttpServer())
      .get('/instruments')
      .query({ q: ticker.toLowerCase() });
    const byName = await request(app.getHttpServer())
      .get('/instruments')
      .query({ q: `searchable ${suffix}` });

    expect(byTicker.status).toBe(200);
    expect(byTicker.body).toEqual([
      expect.objectContaining({
        id: stock,
        ticker,
        name,
        type: 'ACCIONES',
      }),
    ]);
    expect(byName.status).toBe(200);
    expect(byName.body.map((item: { ticker: string }) => item.ticker)).toEqual([
      ticker,
    ]);
    expect(
      [...byTicker.body, ...byName.body].some(
        (item: { type: string }) => item.type === 'MONEDA',
      ),
    ).toBe(false);
  });

  it('returns the portfolio of the requested user', async () => {
    const trader = await createTrader({ cash: '5000' });

    const response = await request(app.getHttpServer())
      .get('/portfolio')
      .set('X-User-Id', trader.userId);

    expect(response.status).toBe(200);
    expect(response.body.accountId).toBe(trader.accountId);
    expect(sameMoney(response.body.settledCash, '5000')).toBe(true);
    expect(sameMoney(response.body.reservedCash, '0')).toBe(true);
    expect(sameMoney(response.body.availableCash, '5000')).toBe(true);
    expect(sameMoney(response.body.totalValue, '5000')).toBe(true);
    expect(response.body.positions).toEqual([]);
  });

  it('submits, replays and rejects orders through the real application', async () => {
    const trader = await createTrader({ cash: '1000000', close: '100.50' });
    const server = app.getHttpServer();
    const marketBody = {
      instrumentId: trader.instrumentId,
      side: 'BUY',
      type: 'MARKET',
      quantity: '2',
    };
    const marketKey = idempotencyKey();

    const filled = await request(server)
      .post('/orders')
      .set(headers(trader.userId, marketKey))
      .send(marketBody);
    const replay = await request(server)
      .post('/orders')
      .set(headers(trader.userId, marketKey))
      .send(marketBody);
    const conflict = await request(server)
      .post('/orders')
      .set(headers(trader.userId, marketKey))
      .send({ ...marketBody, quantity: '3' });
    const limit = await request(server)
      .post('/orders')
      .set(headers(trader.userId, idempotencyKey()))
      .send({
        instrumentId: trader.instrumentId,
        side: 'BUY',
        type: 'LIMIT',
        limitPrice: '100.00',
        amount: '1000.00',
      });
    const broke = await createTrader({ close: '100.50' });
    const rejected = await request(server)
      .post('/orders')
      .set(headers(broke.userId, idempotencyKey()))
      .send({
        instrumentId: broke.instrumentId,
        side: 'BUY',
        type: 'MARKET',
        quantity: '1',
      });

    expect(filled.status).toBe(201);
    expect(filled.body).toMatchObject({
      status: 'FILLED',
      side: 'BUY',
      type: 'MARKET',
      size: '2',
    });
    expect(sameMoney(filled.body.price, '100.50')).toBe(true);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(filled.body.id);
    expect(conflict.status).toBe(409);
    expect(limit.status).toBe(201);
    expect(limit.body).toMatchObject({
      status: 'NEW',
      type: 'LIMIT',
      size: '10',
    });
    expect(sameMoney(limit.body.price, '100.00')).toBe(true);
    expect(rejected.status).toBe(201);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'INSUFFICIENT_CASH',
    });
    expect(
      await prisma.order.count({
        where: { accountId: trader.accountId, side: 'BUY' },
      }),
    ).toBe(2);
  });

  it('cancels a new limit order and rejects the other cases', async () => {
    const trader = await createTrader({ cash: '1000000' });
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/orders')
      .set(headers(trader.userId, idempotencyKey()))
      .send({
        instrumentId: trader.instrumentId,
        side: 'BUY',
        type: 'LIMIT',
        limitPrice: '50.00',
        quantity: '4',
      });
    const cancelled = await request(server)
      .post(`/orders/${created.body.id}/cancel`)
      .set(headers(trader.userId, idempotencyKey()));
    const again = await request(server)
      .post(`/orders/${created.body.id}/cancel`)
      .set(headers(trader.userId, idempotencyKey()));
    const missing = await request(server)
      .post(`/orders/${randomUUID()}/cancel`)
      .set(headers(trader.userId, idempotencyKey()));

    expect(created.status).toBe(201);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(again.status).toBe(409);
    expect(missing.status).toBe(404);
  });

  it('rejects invalid HTTP requests before creating an order', async () => {
    const server = app.getHttpServer();
    const body = {
      instrumentId: randomUUID(),
      side: 'BUY',
      type: 'MARKET',
      quantity: '1',
    };

    expect((await request(server).post('/orders').send(body)).status).toBe(400);
    expect(
      (
        await request(server)
          .post('/orders')
          .set('X-User-Id', 'not-a-uuid')
          .set('Idempotency-Key', idempotencyKey())
          .send(body)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post('/orders')
          .set('X-User-Id', randomUUID())
          .send(body)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post('/orders')
          .set(headers(randomUUID(), idempotencyKey()))
          .send({ ...body, amount: '10.00' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post('/orders')
          .set(headers(randomUUID(), idempotencyKey()))
          .send({ ...body, extra: true })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post('/orders')
          .set(headers(randomUUID(), idempotencyKey()))
          .send({ ...body, limitPrice: '10.00' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(server)
          .post('/orders')
          .set(headers(randomUUID(), idempotencyKey()))
          .send({
            instrumentId: randomUUID(),
            side: 'BUY',
            type: 'LIMIT',
            quantity: '1',
          })
      ).status,
    ).toBe(400);
    expect(await prisma.order.count({ where: { instrumentId: body.instrumentId } })).toBe(
      0,
    );
  });

  async function createTrader(input: { cash?: string; close?: string }) {
    const userId = randomUUID();
    const accountId = randomUUID();
    const instrumentId = await createInstrument({
      ticker: tickerOf('HT'),
      name: `Http Trader ${userId}`,
      type: 'ACCIONES',
    });

    owned.users.push(userId);
    owned.accounts.push(accountId);
    await prisma.user.create({
      data: { id: userId, email: `http-${userId}@test.local` },
    });
    await prisma.account.create({
      data: {
        id: accountId,
        userId,
        accountNumber: `http-${accountId}`,
      },
    });

    if (input.close) {
      const quoteId = randomUUID();
      owned.quotes.push(quoteId);
      await prisma.marketData.create({
        data: {
          id: quoteId,
          instrumentId,
          high: '120.00',
          low: '80.00',
          open: '100.00',
          close: input.close,
          previousClose: '90.00',
          observedAt: new Date(),
        },
      });
    }

    if (input.cash) {
      await prisma.order.create({
        data: {
          id: randomUUID(),
          accountId,
          instrumentId: arsId,
          side: 'CASH_IN',
          size: input.cash,
          status: 'FILLED',
          placedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
    }

    return { userId, accountId, instrumentId };
  }

  async function createInstrument(input: {
    ticker: string;
    name: string;
    type: string;
  }): Promise<string> {
    const id = randomUUID();
    owned.instruments.push(id);
    await prisma.instrument.create({ data: { id, ...input } });
    return id;
  }
});

function headers(userId: string, key: string): Record<string, string> {
  return {
    'X-User-Id': userId,
    'Idempotency-Key': key,
  };
}

function idempotencyKey(): string {
  return `http-${randomUUID()}`;
}

function tickerOf(prefix: string): string {
  return `${prefix}${randomUUID().replaceAll('-', '').slice(0, 8)}`.toUpperCase();
}

function sameMoney(actual: string, expected: string): boolean {
  return Money.fromCalculation(actual).equals(Money.parse(expected));
}

function isLocalDatabase(connectionString: string): boolean {
  const host = new URL(connectionString).hostname;

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
