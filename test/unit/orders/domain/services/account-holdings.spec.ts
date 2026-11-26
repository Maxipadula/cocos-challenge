import { describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';

import { CashMovement } from '#orders/domain/entities/cash-movement.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import { InvalidShareQuantityError } from '#orders/domain/errors/order-errors.js';
import { accountHoldings } from '#orders/domain/services/account-holdings.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';

import {
  account,
  identity,
  peso,
  placedAt,
  price,
  stock,
} from '../order-fixture.js';

const maxShare = 10n ** 20n - 1n;

describe('accountHoldings', () => {
  it('sums settled cash, committed cash and signed share quantities', () => {
    const holdings = accountHoldings([
      CashMovement.cashIn({
        id: identity(1, 1n).id,
        accountId: account,
        instrumentId: peso,
        amount: Money.parse('9'.repeat(20)),
        placedAt,
      }),
      CashMovement.cashIn({
        id: identity(2, 1n).id,
        accountId: account,
        instrumentId: peso,
        amount: Money.parse('9'.repeat(20)),
        placedAt,
      }),
      CashMovement.reconstitute({
        id: identity(3, 1n).id,
        accountId: account,
        instrumentId: peso,
        amount: Money.parse('1.00'),
        placedAt,
        side: 'CASH_OUT',
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_CASH',
      }),
      TradeOrder.marketFilled({
        ...identity(4, 5n),
        side: 'BUY',
        price: price('10.00'),
      }),
      TradeOrder.marketFilled({
        ...identity(5, 2n),
        side: 'SELL',
        price: price('10.00'),
      }),
      TradeOrder.limitOpen({
        ...identity(6, 4n),
        side: 'BUY',
        price: price('8.00'),
      }),
      TradeOrder.limitOpen({
        ...identity(7, 9n),
        side: 'SELL',
        price: price('8.00'),
      }),
      TradeOrder.marketRejected({
        ...identity(8, 100n),
        side: 'BUY',
        price: price('10.00'),
        reason: 'INSUFFICIENT_CASH',
      }),
      TradeOrder.limitCancelled({
        ...identity(9, 100n),
        side: 'SELL',
        price: price('10.00'),
      }),
    ]);

    expect(holdings.settledCash.toDecimalString()).toBe(
      Money.parse('9'.repeat(20))
        .add(Money.parse('9'.repeat(20)))
        .subtract(Money.parse('50.00'))
        .add(Money.parse('20.00'))
        .toDecimalString(),
    );
    expect(holdings.settledCash.integerDigitCount()).toBe(21);
    expect(holdings.committedCash.toDecimalString()).toBe('32.00');
    expect(holdings.positions).toEqual([{ instrumentId: stock, quantity: 3n }]);
  });

  it('omits a zero net quantity and keeps a negative quantity', () => {
    const flat = accountHoldings([
      TradeOrder.marketFilled({
        ...identity(1, 5n),
        side: 'BUY',
        price: price('1'),
      }),
      TradeOrder.marketFilled({
        ...identity(2, 5n),
        side: 'SELL',
        price: price('1'),
      }),
    ]);
    const negative = accountHoldings([
      TradeOrder.marketFilled({
        ...identity(3, 4n),
        side: 'SELL',
        price: price('1'),
      }),
    ]);

    expect(flat.positions).toEqual([]);
    expect(negative.positions).toEqual([
      { instrumentId: stock, quantity: -4n },
    ]);
  });

  it('keeps a net quantity above the persistable share limit', () => {
    const holdings = accountHoldings([
      TradeOrder.marketFilled({
        ...identity(1, maxShare),
        side: 'BUY',
        price: price('1'),
      }),
      TradeOrder.marketFilled({
        ...identity(2, maxShare),
        side: 'BUY',
        price: price('1'),
      }),
    ]);
    const quantity = holdings.positions[0]?.quantity ?? 0n;

    expect(quantity).toBe(maxShare * 2n);
    expect(() => ShareQuantity.of(quantity)).toThrow(InvalidShareQuantityError);
  });

  it('returns zero cash for an account without entries', () => {
    const holdings = accountHoldings([]);

    expect(holdings.settledCash.toDecimalString()).toBe('0');
    expect(holdings.committedCash.toDecimalString()).toBe('0');
    expect(holdings.positions).toEqual([]);
  });
});
