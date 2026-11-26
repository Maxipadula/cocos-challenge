import { describe, expect, it } from 'vitest';
import { Money } from '../../../../../src/shared/domain/value-objects/money.js';
import { CashMovement } from '../../../../../src/orders/domain/entities/cash-movement.js';
import { TradeOrder } from '../../../../../src/orders/domain/entities/trade-order.js';
import {
  availableCash,
  availableShares,
} from '../../../../../src/orders/domain/services/availability.js';
import { instrumentId } from '../../../../../src/shared/domain/value-objects/ids.js';
import { identity, peso, price, stock } from '../order-fixture.js';

describe('availability', () => {
  it('starts at zero when there are no orders', () => {
    expect(availableCash([]).isZero()).toBe(true);
    expect(availableShares([], stock).isZero()).toBe(true);
  });

  it('derives cash from filled movements and buy limit commitments', () => {
    const entries = [
      CashMovement.cashIn({
        ...identity(1, 1n),
        instrumentId: peso,
        amount: Money.parse('100.00'),
      }),
      TradeOrder.marketFilled({
        ...identity(2, 2n),
        side: 'BUY',
        price: price('10.00'),
      }),
      TradeOrder.limitOpen({
        ...identity(3, 3n),
        side: 'BUY',
        price: price('10.00'),
      }),
      TradeOrder.marketRejected({
        ...identity(4, 9n),
        side: 'BUY',
        price: price('10.00'),
        reason: 'INSUFFICIENT_CASH',
      }),
      TradeOrder.limitCancelled({
        ...identity(5, 9n),
        side: 'BUY',
        price: price('10.00'),
      }),
    ];

    expect(availableCash(entries).toDecimalString()).toBe('50.00');
  });

  it('derives shares from filled trades minus new limit sells', () => {
    const other = instrumentId(99);
    const entries = [
      TradeOrder.marketFilled({
        ...identity(1, 10n),
        side: 'BUY',
        price: price('5.00'),
      }),
      TradeOrder.marketFilled({
        ...identity(2, 3n),
        side: 'SELL',
        price: price('5.00'),
      }),
      TradeOrder.limitOpen({
        ...identity(3, 4n),
        side: 'SELL',
        price: price('6.00'),
      }),
      TradeOrder.limitRejected({
        ...identity(4, 8n),
        side: 'SELL',
        price: price('6.00'),
        reason: 'INSUFFICIENT_SHARES',
      }),
      TradeOrder.marketFilled({
        ...identity(5, 20n),
        instrumentId: other,
        side: 'BUY',
        price: price('1.00'),
      }),
    ];

    expect(availableShares(entries, stock).toBigInt()).toBe(3n);
    expect(availableShares(entries, other).toBigInt()).toBe(20n);
  });

  it('releases a buy commitment when the limit order is cancelled', () => {
    const open = TradeOrder.limitOpen({
      ...identity(1, 2n),
      side: 'BUY',
      price: price('10.00'),
    });
    const cash = CashMovement.cashIn({
      ...identity(2, 1n),
      instrumentId: peso,
      amount: Money.parse('100.00'),
    });

    expect(availableCash([cash, open]).toDecimalString()).toBe('80.00');
    expect(availableCash([cash, open.cancel()]).toDecimalString()).toBe(
      '100.00',
    );
  });

  it('returns zero shares when commitments exceed the filled position', () => {
    const entries = [
      TradeOrder.marketFilled({
        ...identity(1, 1n),
        side: 'BUY',
        price: price('5.00'),
      }),
      TradeOrder.limitOpen({
        ...identity(2, 4n),
        side: 'SELL',
        price: price('5.00'),
      }),
    ];

    expect(availableShares(entries, stock).isZero()).toBe(true);
  });
});
