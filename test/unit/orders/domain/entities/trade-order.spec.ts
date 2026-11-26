import { describe, expect, it } from 'vitest';

import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import {
  InvalidOrderTimestampError,
  OrderNotCancellableError,
  OrderSizeRequiredError,
} from '#orders/domain/errors/order-errors.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';

import { identity, price, stock } from '../order-fixture.js';

describe('TradeOrder', () => {
  it('opens a limit order in NEW and commits a buy for size times price', () => {
    const order = TradeOrder.limitOpen({
      ...identity(1, 3n),
      side: 'BUY',
      price: price('33.33'),
    });

    expect(order.type).toBe('LIMIT');
    expect(order.status).toBe('NEW');
    expect(order.rejectionReason).toBeNull();
    expect(order.committedCash().toDecimalString()).toBe('99.99');
    expect(order.settledCashDelta().toDecimalString()).toBe('0.00');
    expect(order.committedShares(stock).isZero()).toBe(true);
  });

  it('commits shares for a new limit sell and no cash', () => {
    const order = TradeOrder.limitOpen({
      ...identity(2, 4n),
      side: 'SELL',
      price: price('12.00'),
    });

    expect(order.committedShares(stock).toBigInt()).toBe(4n);
    expect(order.committedCash().isZero()).toBe(true);
    expect(order.settledShares(stock)).toBe(0n);
  });

  it('settles a filled market buy at the stored execution price', () => {
    const order = TradeOrder.marketFilled({
      ...identity(3, 2n),
      side: 'BUY',
      price: price('10.00'),
    });

    expect(order.status).toBe('FILLED');
    expect(order.settledCashDelta().toDecimalString()).toBe('-20.00');
    expect(order.settledShares(stock)).toBe(2n);
    expect(order.committedCash().isZero()).toBe(true);
  });

  it('requires a rejection reason and produces no movement', () => {
    const order = TradeOrder.marketRejected({
      ...identity(4, 5n),
      side: 'BUY',
      price: price('10.00'),
      reason: 'INSUFFICIENT_CASH',
    });

    expect(order.status).toBe('REJECTED');
    expect(order.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(order.price.multiply(ShareQuantity.of(1n)).toDecimalString()).toBe(
      '10.00',
    );
    expect(order.settledCashDelta().isZero()).toBe(true);
    expect(order.committedCash().isZero()).toBe(true);
    expect(order.settledShares(stock)).toBe(0n);
  });

  it('cancels only a new limit order and releases its commitment', () => {
    const open = TradeOrder.limitOpen({
      ...identity(5, 3n),
      side: 'BUY',
      price: price('33.33'),
    });
    const cancelled = open.cancel();

    expect(open.status).toBe('NEW');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.price).toBe(open.price);
    expect(cancelled.size.toBigInt()).toBe(3n);
    expect(cancelled.committedCash().isZero()).toBe(true);
    expect(cancelled.settledCashDelta().isZero()).toBe(true);
  });

  it('refuses to cancel a filled, rejected, or already cancelled order', () => {
    const filled = TradeOrder.marketFilled({
      ...identity(6, 1n),
      side: 'SELL',
      price: price('8.00'),
    });
    const rejected = TradeOrder.limitRejected({
      ...identity(7, 1n),
      side: 'SELL',
      price: price('8.00'),
      reason: 'INSUFFICIENT_SHARES',
    });
    const cancelled = TradeOrder.limitCancelled({
      ...identity(8, 1n),
      side: 'BUY',
      price: price('8.00'),
    });

    expect(() => filled.cancel()).toThrow(OrderNotCancellableError);
    expect(() => rejected.cancel()).toThrow(OrderNotCancellableError);
    expect(() => cancelled.cancel()).toThrow(OrderNotCancellableError);
    expect(filled.status).toBe('FILLED');
  });

  it('rejects a zero share size and an invalid timestamp', () => {
    expect(() =>
      TradeOrder.limitOpen({
        ...identity(9, 1n),
        side: 'BUY',
        size: ShareQuantity.zero(),
        price: price('8.00'),
      }),
    ).toThrow(OrderSizeRequiredError);

    expect(() =>
      TradeOrder.marketFilled({
        ...identity(10, 1n),
        side: 'BUY',
        placedAt: new Date('not-a-date'),
        price: price('8.00'),
      }),
    ).toThrow(InvalidOrderTimestampError);
  });
});
