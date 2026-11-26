import { describe, expect, it } from 'vitest';

import { CashMovement } from '#orders/domain/entities/cash-movement.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import { OrderPersistenceError } from '#orders/infrastructure/prisma/order-persistence.error.js';
import { reconstituteStoredOrder } from '#orders/infrastructure/prisma/order-row.mapper.js';

import { Prisma } from '../../../../src/generated/prisma/client.js';
import { account, fixtureUuid } from '../domain/order-fixture.js';

function row(
  overrides: Partial<{
    id: string;
    side: string;
    size: string;
    price: string | null;
    type: string | null;
    status: string;
    rejectionReason: string | null;
    ticker: string;
    instrumentType: string;
  }> = {},
) {
  return {
    id: overrides.id ?? fixtureUuid(4),
    account_id: account,
    instrument_id: fixtureUuid(20),
    side: overrides.side ?? 'BUY',
    size: new Prisma.Decimal(overrides.size ?? '3'),
    price:
      overrides.price === null
        ? null
        : new Prisma.Decimal(overrides.price ?? '10.50'),
    type: overrides.type === undefined ? 'LIMIT' : overrides.type,
    status: overrides.status ?? 'NEW',
    rejection_reason: overrides.rejectionReason ?? null,
    placed_at: new Date('2026-01-15T15:00:00.000Z'),
    instrument_ticker: overrides.ticker ?? 'GGAL',
    instrument_type: overrides.instrumentType ?? 'ACCIONES',
  };
}

describe('reconstituteStoredOrder', () => {
  it('reconstitutes every legal trade and cash state', () => {
    const entries = [
      row({ id: fixtureUuid(1), type: 'MARKET', status: 'FILLED' }),
      row({
        id: fixtureUuid(2),
        type: 'MARKET',
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_CASH',
      }),
      row({ id: fixtureUuid(3), status: 'NEW' }),
      row({
        id: fixtureUuid(4),
        side: 'SELL',
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_SHARES',
      }),
      row({ id: fixtureUuid(5), status: 'CANCELLED' }),
      row({
        id: fixtureUuid(6),
        side: 'CASH_IN',
        size: '1500.50',
        price: null,
        type: null,
        status: 'FILLED',
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
      row({
        id: fixtureUuid(7),
        side: 'CASH_OUT',
        size: '40.50',
        price: null,
        type: null,
        status: 'FILLED',
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
      row({
        id: fixtureUuid(8),
        side: 'CASH_OUT',
        size: '80.00',
        price: null,
        type: null,
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_CASH',
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
    ].map((stored) => reconstituteStoredOrder(stored));

    expect(entries[0]).toBeInstanceOf(TradeOrder);
    expect((entries[0] as TradeOrder).type).toBe('MARKET');
    expect((entries[0] as TradeOrder).status).toBe('FILLED');
    expect((entries[1] as TradeOrder).status).toBe('REJECTED');
    expect((entries[2] as TradeOrder).type).toBe('LIMIT');
    expect((entries[2] as TradeOrder).status).toBe('NEW');
    expect((entries[3] as TradeOrder).rejectionReason).toBe(
      'INSUFFICIENT_SHARES',
    );
    expect((entries[4] as TradeOrder).status).toBe('CANCELLED');
    expect(entries[5]).toBeInstanceOf(CashMovement);
    expect((entries[5] as CashMovement).cashStatus).toBe('FILLED');
    expect((entries[6] as CashMovement).settledCashDelta().isNegative()).toBe(
      true,
    );
    expect((entries[7] as CashMovement).cashStatus).toBe('REJECTED');
    expect((entries[7] as CashMovement).settledCashDelta().isZero()).toBe(true);
  });

  it('rejects an invalid combination, a currency trade and a non ARS cash movement', () => {
    expect(() =>
      reconstituteStoredOrder(row({ type: 'MARKET', status: 'NEW' })),
    ).toThrow(OrderPersistenceError);
    expect(() =>
      reconstituteStoredOrder(
        row({ instrumentType: 'MONEDA', ticker: 'ARS' }),
      ),
    ).toThrow(OrderPersistenceError);
    expect(() =>
      reconstituteStoredOrder(
        row({
          side: 'CASH_IN',
          price: null,
          type: null,
          status: 'FILLED',
          ticker: 'GGAL',
          instrumentType: 'ACCIONES',
        }),
      ),
    ).toThrow(OrderPersistenceError);
    expect(() =>
      reconstituteStoredOrder(row({ id: 'not-a-uuid' })),
    ).toThrow(OrderPersistenceError);
  });
});
