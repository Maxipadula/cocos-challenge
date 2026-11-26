import { describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';

import { Account } from '#orders/domain/entities/account.js';
import { CashMovement } from '#orders/domain/entities/cash-movement.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import {
  NonPositiveAmountError,
  OrderSizeRequiredError,
} from '#orders/domain/errors/order-errors.js';
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
const position = decideTradeOrder(Account.open(account), [deposit], {
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
      Account.open(account),
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
    const opened = Account.open(account);
    const order = decideTradeOrder(
      opened,
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
    expect(order.price.multiply(order.size).toDecimalString()).toBe('99.99');
    expect(
      opened
        .reserveCash(order.price.multiply(order.size))
        .availableCash(Money.parse('100.00'))
        .toDecimalString(),
    ).toBe('0.01');
  });

  it('rejects a buy that costs more than the available cash', () => {
    const order = decideTradeOrder(
      Account.open(account),
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
    expect(order.settledCashDelta().isZero()).toBe(true);
  });

  it('opens a limit sell when the shares are available and rejects when they are not', () => {
    const accepted = decideTradeOrder(Account.open(account), funded, {
      id: orderId(fixtureUuid(11)),
      accountId: account,
      instrumentId: stock,
      side: 'SELL',
      type: 'LIMIT',
      limitPrice: price('12.50'),
      sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(3n) },
      placedAt,
    });
    const reserved = Account.open(account).reserveShares(stock, accepted.size);
    const rejected = decideTradeOrder(reserved, [...funded, accepted], {
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
    expect(accepted.size.toBigInt()).toBe(3n);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('INSUFFICIENT_SHARES');
    expect(reserved.availableShares(stock, 4n)).toBe(1n);
    expect(rejected.settledShares(stock)).toBe(0n);
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
      decideTradeOrder(Account.open(account), cash, {
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
      decideTradeOrder(Account.open(account), cash, {
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

  it('ignores limit commitments stored on orders and uses the account reserve', () => {
    const cash = [
      CashMovement.cashIn({
        ...identity(1, 1n),
        instrumentId: peso,
        amount: Money.parse('100.00'),
      }),
    ];
    const parkedLimit = TradeOrder.limitOpen({
      ...identity(3, 6n),
      side: 'BUY',
      price: price('10.00'),
    });
    const withoutReserve = decideTradeOrder(
      Account.open(account),
      [...cash, parkedLimit],
      {
        id: orderId(fixtureUuid(15)),
        accountId: account,
        instrumentId: stock,
        side: 'BUY',
        type: 'MARKET',
        executionPrice: price('10.00'),
        sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(5n) },
        placedAt,
      },
    );
    const withReserve = decideTradeOrder(
      Account.open(account).reserveCash(Money.parse('60.00')),
      cash,
      {
        id: orderId(fixtureUuid(16)),
        accountId: account,
        instrumentId: stock,
        side: 'BUY',
        type: 'MARKET',
        executionPrice: price('10.00'),
        sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(5n) },
        placedAt,
      },
    );

    expect(withoutReserve.status).toBe('FILLED');
    expect(withReserve.status).toBe('REJECTED');
    expect(withReserve.rejectionReason).toBe('INSUFFICIENT_CASH');
  });
});
