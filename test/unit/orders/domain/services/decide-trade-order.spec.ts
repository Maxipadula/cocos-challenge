import { describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';

import { CashMovement } from '#orders/domain/entities/cash-movement.js';
import {
  NonPositiveAmountError,
  OrderSizeRequiredError,
} from '#orders/domain/errors/order-errors.js';
import {
  availableCash,
  availableShares,
} from '#orders/domain/services/availability.js';
import { decideTradeOrder } from '#orders/domain/services/decide-trade-order.js';
import { orderId } from '#orders/domain/value-objects/order-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';

import {
  account,
  fixtureUuid,
  identity,
  peso,
  placedAt,
  price,
  stock,
} from '../order-fixture.js';

const deposit = CashMovement.cashIn({
  ...identity(1, 1n),
  instrumentId: peso,
  amount: Money.parse('100.00'),
});
const position = decideTradeOrder([deposit], {
  id: orderId(fixtureUuid(2)),
  accountId: account,
  instrumentId: stock,
  side: 'BUY',
  type: 'MARKET',
  executionPrice: price('10.00'),
  sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(4n) },
  placedAt,
});
const funded = [deposit, position];

describe('decideTradeOrder', () => {
  it('fills a market buy by quantity at the given close', () => {
    const order = decideTradeOrder(
      [
        CashMovement.cashIn({
          ...identity(1, 1n),
          instrumentId: peso,
          amount: Money.parse('100.00'),
        }),
      ],
      {
        id: orderId(fixtureUuid(8)),
        accountId: account,
        instrumentId: stock,
        side: 'BUY',
        type: 'MARKET',
        executionPrice: price('10.00'),
        sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(2n) },
        placedAt,
      },
    );

    expect(order.status).toBe('FILLED');
    expect(order.price).toEqual(price('10.00'));
    expect(order.settledCashDelta().toDecimalString()).toBe('-20.00');
  });

  it('floors an amount into whole shares and leaves the remainder unspent', () => {
    const order = decideTradeOrder(
      [
        CashMovement.cashIn({
          ...identity(1, 1n),
          instrumentId: peso,
          amount: Money.parse('100.00'),
        }),
      ],
      {
        id: orderId(fixtureUuid(9)),
        accountId: account,
        instrumentId: stock,
        side: 'BUY',
        type: 'LIMIT',
        limitPrice: price('33.33'),
        sizing: { kind: 'AMOUNT', amount: Money.parse('100.00') },
        placedAt,
      },
    );

    expect(order.status).toBe('NEW');
    expect(order.size.toBigInt()).toBe(3n);
    expect(order.committedCash().toDecimalString()).toBe('99.99');
    expect(
      availableCash([
        CashMovement.cashIn({
          ...identity(1, 1n),
          instrumentId: peso,
          amount: Money.parse('100.00'),
        }),
        order,
      ]).toDecimalString(),
    ).toBe('0.01');
  });

  it('rejects a buy that costs more than the available cash', () => {
    const order = decideTradeOrder(
      [
        CashMovement.cashIn({
          ...identity(1, 1n),
          instrumentId: peso,
          amount: Money.parse('10.00'),
        }),
      ],
      {
        id: orderId(fixtureUuid(10)),
        accountId: account,
        instrumentId: stock,
        side: 'BUY',
        type: 'MARKET',
        executionPrice: price('10.00'),
        sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(2n) },
        placedAt,
      },
    );

    expect(order.status).toBe('REJECTED');
    expect(order.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(order.size.toBigInt()).toBe(2n);
    expect(
      availableCash([
        CashMovement.cashIn({
          ...identity(1, 1n),
          instrumentId: peso,
          amount: Money.parse('10.00'),
        }),
        order,
      ]).toDecimalString(),
    ).toBe('10.00');
  });

  it('opens a limit sell when the shares are available and rejects when they are not', () => {
    const accepted = decideTradeOrder(funded, {
      id: orderId(fixtureUuid(11)),
      accountId: account,
      instrumentId: stock,
      side: 'SELL',
      type: 'LIMIT',
      limitPrice: price('12.50'),
      sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(3n) },
      placedAt,
    });
    const rejected = decideTradeOrder([...funded, accepted], {
      id: orderId(fixtureUuid(12)),
      accountId: account,
      instrumentId: stock,
      side: 'SELL',
      type: 'MARKET',
      executionPrice: price('12.50'),
      sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(2n) },
      placedAt,
    });

    expect(accepted.status).toBe('NEW');
    expect(accepted.committedShares(stock).toBigInt()).toBe(3n);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('INSUFFICIENT_SHARES');
    expect(
      availableShares([...funded, accepted, rejected], stock).toBigInt(),
    ).toBe(1n);
  });

  it('rejects an amount that cannot buy one share and a non-positive amount', () => {
    const cash = [
      CashMovement.cashIn({
        ...identity(1, 1n),
        instrumentId: peso,
        amount: Money.parse('100.00'),
      }),
    ];

    expect(() =>
      decideTradeOrder(cash, {
        id: orderId(fixtureUuid(13)),
        accountId: account,
        instrumentId: stock,
        side: 'BUY',
        type: 'MARKET',
        executionPrice: price('50.00'),
        sizing: { kind: 'AMOUNT', amount: Money.parse('49.99') },
        placedAt,
      }),
    ).toThrow(OrderSizeRequiredError);

    expect(() =>
      decideTradeOrder(cash, {
        id: orderId(fixtureUuid(14)),
        accountId: account,
        instrumentId: stock,
        side: 'SELL',
        type: 'LIMIT',
        limitPrice: price('10.00'),
        sizing: { kind: 'AMOUNT', amount: Money.parse('0.00') },
        placedAt,
      }),
    ).toThrow(NonPositiveAmountError);
  });
});
