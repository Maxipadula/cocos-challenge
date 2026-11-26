import { Money } from '#shared/domain/value-objects/money.js';

import { type Account } from '../entities/account.js';
import { TradeOrder, type TradeSide } from '../entities/trade-order.js';
import {
  NonPositiveAmountError,
  OrderSizeRequiredError,
} from '../errors/order-errors.js';
import type { AccountId } from '../value-objects/account-id.js';
import type { InstrumentId } from '../value-objects/instrument-id.js';
import type { OrderId } from '../value-objects/order-id.js';
import type { ShareQuantity } from '../value-objects/share-quantity.js';
import type { UnitPrice } from '../value-objects/unit-price.js';
import type { AccountEntry } from './availability.js';

export type TradeSizing =
  | { readonly kind: 'QUANTITY'; readonly quantity: ShareQuantity }
  | { readonly kind: 'AMOUNT'; readonly amount: Money };

type DecideTradeOrderBase = {
  readonly id: OrderId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  readonly side: TradeSide;
  readonly placedAt: Date;
  readonly sizing: TradeSizing;
};

export type DecideTradeOrderCommand = DecideTradeOrderBase &
  (
    | { readonly type: 'MARKET'; readonly executionPrice: UnitPrice }
    | { readonly type: 'LIMIT'; readonly limitPrice: UnitPrice }
  );

export function decideTradeOrder(
  account: Account,
  existing: readonly AccountEntry[],
  command: DecideTradeOrderCommand,
): TradeOrder {
  const price =
    command.type === 'MARKET' ? command.executionPrice : command.limitPrice;
  const size = resolveSize(command.sizing, price);
  const identity = {
    id: command.id,
    accountId: command.accountId,
    instrumentId: command.instrumentId,
    side: command.side,
    size,
    placedAt: command.placedAt,
    price,
  };

  if (command.side === 'BUY') {
    const cost = price.multiply(size);

    if (account.availableCash(settledCash(existing)).lessThan(cost)) {
      return command.type === 'MARKET'
        ? TradeOrder.marketRejected({
            ...identity,
            reason: 'INSUFFICIENT_CASH',
          })
        : TradeOrder.limitRejected({
            ...identity,
            reason: 'INSUFFICIENT_CASH',
          });
    }
  } else if (
    account.availableShares(
      command.instrumentId,
      settledShares(existing, command.instrumentId),
    ) < size.toBigInt()
  ) {
    return command.type === 'MARKET'
      ? TradeOrder.marketRejected({
          ...identity,
          reason: 'INSUFFICIENT_SHARES',
        })
      : TradeOrder.limitRejected({
          ...identity,
          reason: 'INSUFFICIENT_SHARES',
        });
  }

  return command.type === 'MARKET'
    ? TradeOrder.marketFilled(identity)
    : TradeOrder.limitOpen(identity);
}

function settledCash(entries: readonly AccountEntry[]): Money {
  return entries.reduce(
    (total, entry) => total.add(entry.settledCashDelta()),
    Money.zero(),
  );
}

function settledShares(
  entries: readonly AccountEntry[],
  instrumentId: InstrumentId,
): bigint {
  return entries.reduce(
    (total, entry) =>
      entry instanceof TradeOrder
        ? total + entry.settledShares(instrumentId)
        : total,
    0n,
  );
}

function resolveSize(sizing: TradeSizing, price: UnitPrice): ShareQuantity {
  if (sizing.kind === 'QUANTITY') {
    if (sizing.quantity.isZero()) {
      throw new OrderSizeRequiredError();
    }

    return sizing.quantity;
  }

  if (!sizing.amount.isPositive()) {
    throw new NonPositiveAmountError();
  }

  const shares = price.floorShares(sizing.amount);

  if (shares.isZero()) {
    throw new OrderSizeRequiredError();
  }

  return shares;
}
