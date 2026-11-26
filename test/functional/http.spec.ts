import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { IdempotencyConflictError } from '#shared/application/idempotency-store.js';
import { uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { SearchInstruments } from '#instruments/application/use-cases/search-instruments.js';
import { AccountNotFoundError } from '#orders/application/errors/account-not-found.error.js';
import { CancelTradeOrder } from '#orders/application/use-cases/cancel-trade-order.js';
import {
  InstrumentNotFoundError,
  InstrumentNotTradableError,
  MarketPriceUnavailableError,
  SubmitTradeOrder,
} from '#orders/application/use-cases/submit-trade-order.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { PortfolioAccountNotFoundError } from '#portfolio/application/errors/portfolio-account-not-found.error.js';
import { GetPortfolio } from '#portfolio/application/use-cases/get-portfolio.js';

import { AppModule } from '../../src/app.module.js';

const user = '00000000-0000-4000-8000-000000000007';
const instrument = '00000000-0000-4000-8000-000000000014';
const order = '00000000-0000-4000-8000-000000000021';

// Presentation only. The use cases below are fakes, so these tests do not
// cover Nest wiring through the real use cases and PostgreSQL.
describe('HTTP presentation with simulated use cases', () => {
  let app: INestApplication;
  let baseUrl: string;
  const search = vi.fn();
  const portfolio = vi.fn();
  const submit = vi.fn();
  const cancel = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: async () => undefined,
        $disconnect: async () => undefined,
        $transaction: async () => undefined,
      })
      .overrideProvider(SearchInstruments)
      .useValue({ execute: search })
      .overrideProvider(GetPortfolio)
      .useValue({ execute: portfolio })
      .overrideProvider(SubmitTradeOrder)
      .useValue({ execute: submit })
      .overrideProvider(CancelTradeOrder)
      .useValue({ execute: cancel })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('searches instruments by the q query', async () => {
    search.mockResolvedValueOnce([
      {
        id: uuid(instrument),
        ticker: 'GGAL',
        name: 'Grupo Financiero Galicia',
        type: 'ACCIONES',
      },
    ]);

    const response = await fetch(`${baseUrl}/instruments?q=GGAL`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: instrument,
        ticker: 'GGAL',
        name: 'Grupo Financiero Galicia',
        type: 'ACCIONES',
      },
    ]);
    expect(search).toHaveBeenCalledWith('GGAL', undefined);
  });

  it('rejects an instrument search without q or with an unknown query field', async () => {
    search.mockClear();

    expect((await fetch(`${baseUrl}/instruments`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/instruments?q=GGAL&page=1`)).status).toBe(
      400,
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('returns the portfolio of the user header', async () => {
    portfolio.mockResolvedValueOnce({
      accountId: '00000000-0000-4000-8000-000000000003',
      settledCash: '10',
      reservedCash: '0',
      availableCash: '10',
      totalValue: '10',
      positions: [],
    });

    const response = await fetch(`${baseUrl}/portfolio`, {
      headers: { 'X-User-Id': user },
    });

    expect(response.status).toBe(200);
    expect(portfolio).toHaveBeenCalledWith(uuid(user));
    expect((await fetch(`${baseUrl}/portfolio`)).status).toBe(400);
    expect(
      (
        await fetch(`${baseUrl}/portfolio`, {
          headers: { 'X-User-Id': 'user' },
        })
      ).status,
    ).toBe(400);
  });

  it('submits a market quantity and a limit amount without duplicating rules', async () => {
    submit.mockResolvedValue({
      id: order,
      accountId: '00000000-0000-4000-8000-000000000003',
      instrumentId: instrument,
      side: 'BUY',
      type: 'MARKET',
      status: 'FILLED',
      size: '2',
      price: '10.50',
      rejectionReason: null,
      placedAt: '2026-01-15T15:00:00.000Z',
    });

    const market = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        instrumentId: instrument,
        side: 'BUY',
        type: 'MARKET',
        quantity: '2',
      }),
    });
    const limit = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        instrumentId: instrument,
        side: 'SELL',
        type: 'LIMIT',
        limitPrice: '10.50',
        amount: '100.00',
      }),
    });

    expect(market.status).toBe(201);
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      userId: user,
      idempotencyKey: 'order-key',
      instrumentId: instrument,
      side: 'BUY',
      type: 'MARKET',
      sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(2n) },
    });
    expect(limit.status).toBe(201);
    expect(submit.mock.calls[1]?.[0]).toMatchObject({
      side: 'SELL',
      type: 'LIMIT',
      sizing: { kind: 'AMOUNT' },
    });
    expect(
      submit.mock.calls[1]?.[0].limitPrice
        .multiply(ShareQuantity.of(1n))
        .toDecimalString(),
    ).toBe('10.50');
  });

  it('rejects orders that mix size fields, prices or unknown properties', async () => {
    submit.mockClear();
    const headers = jsonHeaders();
    const requests = [
      { instrumentId: instrument, side: 'BUY', type: 'MARKET' },
      {
        instrumentId: instrument,
        side: 'BUY',
        type: 'MARKET',
        quantity: '1',
        amount: '10',
      },
      {
        instrumentId: instrument,
        side: 'BUY',
        type: 'MARKET',
        quantity: '1',
        limitPrice: '10',
      },
      {
        instrumentId: instrument,
        side: 'BUY',
        type: 'LIMIT',
        quantity: '1',
      },
      {
        instrumentId: instrument,
        side: 'BUY',
        type: 'MARKET',
        quantity: '1',
        extra: true,
      },
    ];

    for (const body of requests) {
      expect(
        (
          await fetch(`${baseUrl}/orders`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          })
        ).status,
      ).toBe(400);
    }

    expect(
      (
        await fetch(`${baseUrl}/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-User-Id': user },
          body: JSON.stringify({
            instrumentId: instrument,
            side: 'BUY',
            type: 'MARKET',
            quantity: '1',
          }),
        })
      ).status,
    ).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it('cancels a limit order and maps the other outcomes', async () => {
    cancel
      .mockResolvedValueOnce({
        outcome: 'CANCELLED',
        order: {
          id: order,
          accountId: '00000000-0000-4000-8000-000000000003',
          instrumentId: instrument,
          side: 'BUY',
          type: 'LIMIT',
          status: 'CANCELLED',
          size: '2',
          price: '10.50',
          placedAt: '2026-01-15T15:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ outcome: 'NOT_FOUND' })
      .mockResolvedValueOnce({ outcome: 'NOT_CANCELLABLE' });

    const cancelled = await fetch(`${baseUrl}/orders/${order}/cancel`, {
      method: 'POST',
      headers: jsonHeaders(),
    });
    const missing = await fetch(`${baseUrl}/orders/${order}/cancel`, {
      method: 'POST',
      headers: jsonHeaders(),
    });
    const blocked = await fetch(`${baseUrl}/orders/${order}/cancel`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).status).toBe('CANCELLED');
    expect(cancel.mock.calls[0]?.[0].orderId).toBe(order);
    expect(missing.status).toBe(404);
    expect(blocked.status).toBe(409);
  });

  it('maps account, instrument, quote and idempotency failures', async () => {
    portfolio.mockRejectedValueOnce(new PortfolioAccountNotFoundError());
    submit
      .mockRejectedValueOnce(new AccountNotFoundError())
      .mockRejectedValueOnce(new InstrumentNotFoundError())
      .mockRejectedValueOnce(new InstrumentNotTradableError())
      .mockRejectedValueOnce(new MarketPriceUnavailableError())
      .mockRejectedValueOnce(new IdempotencyConflictError())
      .mockResolvedValueOnce({
        id: order,
        accountId: '00000000-0000-4000-8000-000000000003',
        instrumentId: instrument,
        side: 'BUY',
        type: 'MARKET',
        status: 'REJECTED',
        size: '2',
        price: '10.50',
        rejectionReason: 'INSUFFICIENT_CASH',
        placedAt: '2026-01-15T15:00:00.000Z',
      });

    expect(
      (await fetch(`${baseUrl}/portfolio`, { headers: { 'X-User-Id': user } }))
        .status,
    ).toBe(404);

    const orderBody = JSON.stringify({
      instrumentId: instrument,
      side: 'BUY',
      type: 'MARKET',
      quantity: '2',
    });
    const statuses = [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push(
        (
          await fetch(`${baseUrl}/orders`, {
            method: 'POST',
            headers: jsonHeaders(),
            body: orderBody,
          })
        ).status,
      );
    }

    const rejected = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: orderBody,
    });

    expect(statuses).toEqual([404, 422, 422, 422, 409]);
    expect(rejected.status).toBe(201);
    expect((await rejected.json()).status).toBe('REJECTED');
  });

  it('does not expose a cash movement endpoint', async () => {
    const response = await fetch(`${baseUrl}/cash-movements`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ amount: '10' }),
    });

    expect(response.status).toBe(404);
  });
});

function jsonHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-User-Id': user,
    'Idempotency-Key': 'order-key',
  };
}
