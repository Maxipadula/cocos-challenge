import {
  InvalidIdError,
  InvalidMoneyError,
} from '#shared/domain/errors/value-object-errors.js';
import { Money } from '#shared/domain/value-objects/money.js';

import { type Prisma } from '../../../generated/prisma/client.js';
import {
  CashMovement,
  type CashSide,
  type CashStatus,
} from '../../domain/entities/cash-movement.js';
import {
  TradeOrder,
  type TradeSide,
} from '../../domain/entities/trade-order.js';
import {
  InvalidCashMovementError,
  InvalidOrderIdError,
  InvalidOrderTimestampError,
  InvalidShareQuantityError,
  InvalidUnitPriceError,
  NonPositiveAmountError,
  OrderSizeRequiredError,
} from '../../domain/errors/order-errors.js';
import type { AccountEntry } from '../../domain/services/availability.js';
import { accountId } from '../../domain/value-objects/account-id.js';
import { instrumentId } from '../../domain/value-objects/instrument-id.js';
import { orderId } from '../../domain/value-objects/order-id.js';
import {
  rejectionReason,
  type RejectionReason,
} from '../../domain/value-objects/rejection-reason.js';
import { ShareQuantity } from '../../domain/value-objects/share-quantity.js';
import { UnitPrice } from '../../domain/value-objects/unit-price.js';
import { OrderPersistenceError } from './order-persistence.error.js';

const ARS_TICKER = 'ARS';
const CURRENCY_TYPE = 'MONEDA';

export type StoredOrderRow = {
  id: string;
  account_id: string;
  instrument_id: string;
  side: string;
  size: Prisma.Decimal;
  price: Prisma.Decimal | null;
  type: string | null;
  status: string;
  rejection_reason: string | null;
  placed_at: Date;
  instrument_ticker: string;
  instrument_type: string;
};

export function reconstituteStoredOrder(row: StoredOrderRow): AccountEntry {
  if (isCashSide(row.side)) {
    return reconstituteCash(row);
  }

  if (!isTradeSide(row.side)) {
    throw new OrderPersistenceError(`Unknown order side ${row.side}.`);
  }

  return reconstituteTrade(row);
}

export function isTradeSide(side: string): side is TradeSide {
  return side === 'BUY' || side === 'SELL';
}

function reconstituteCash(row: StoredOrderRow): CashMovement {
  if (
    row.instrument_ticker !== ARS_TICKER ||
    row.instrument_type !== CURRENCY_TYPE
  ) {
    throw new OrderPersistenceError(
      'Cash movement must reference the ARS currency instrument.',
    );
  }

  if (row.price !== null || row.type !== null || !isCashSide(row.side)) {
    throw new OrderPersistenceError(
      'Cash movement must not have a price or an order type.',
    );
  }

  try {
    return CashMovement.reconstitute({
      id: orderId(row.id),
      accountId: accountId(row.account_id),
      instrumentId: instrumentId(row.instrument_id),
      amount: Money.parse(decimalToPlainString(row.size)),
      placedAt: row.placed_at,
      side: row.side,
      status: cashStatus(row.status),
      rejectionReason: parseReason(row.rejection_reason),
    });
  } catch (error) {
    rethrowAsPersistenceError(error);
  }
}

function reconstituteTrade(row: StoredOrderRow): TradeOrder {
  if (row.instrument_type === CURRENCY_TYPE) {
    throw new OrderPersistenceError(
      'A trade order must not reference a currency instrument.',
    );
  }

  if (!isTradeSide(row.side) || row.price === null || row.type === null) {
    throw new OrderPersistenceError('Trade order row is incomplete.');
  }

  try {
    const props = {
      id: orderId(row.id),
      accountId: accountId(row.account_id),
      instrumentId: instrumentId(row.instrument_id),
      side: row.side,
      size: shareQuantityFromDecimal(row.size),
      placedAt: row.placed_at,
      price: UnitPrice.parse(decimalToPlainString(row.price)),
    };
    const reason = parseReason(row.rejection_reason);

    if (!isLegalTrade(row.type, row.status, row.side, reason)) {
      throw new OrderPersistenceError('Trade order row has an illegal state.');
    }

    if (row.type === 'MARKET' && row.status === 'FILLED') {
      return TradeOrder.marketFilled(props);
    }

    if (row.type === 'MARKET' && row.status === 'REJECTED' && reason) {
      return TradeOrder.marketRejected({ ...props, reason });
    }

    if (row.type === 'LIMIT' && row.status === 'NEW') {
      return TradeOrder.limitOpen(props);
    }

    if (row.type === 'LIMIT' && row.status === 'REJECTED' && reason) {
      return TradeOrder.limitRejected({ ...props, reason });
    }

    return TradeOrder.limitCancelled(props);
  } catch (error) {
    rethrowAsPersistenceError(error);
  }
}

function isLegalTrade(
  type: string,
  status: string,
  side: TradeSide,
  reason: RejectionReason | null,
): boolean {
  if (status === 'REJECTED') {
    return (
      (side === 'BUY' && reason === 'INSUFFICIENT_CASH') ||
      (side === 'SELL' && reason === 'INSUFFICIENT_SHARES')
    );
  }

  if (reason !== null) {
    return false;
  }

  if (type === 'MARKET') {
    return status === 'FILLED';
  }

  return type === 'LIMIT' && (status === 'NEW' || status === 'CANCELLED');
}

function isCashSide(side: string): side is CashSide {
  return side === 'CASH_IN' || side === 'CASH_OUT';
}

function cashStatus(status: string): CashStatus {
  if (status === 'FILLED' || status === 'REJECTED') {
    return status;
  }

  throw new OrderPersistenceError(`Unknown cash status ${status}.`);
}

function parseReason(value: string | null): RejectionReason | null {
  if (value === null) {
    return null;
  }

  try {
    return rejectionReason(value);
  } catch (error) {
    throw new OrderPersistenceError(
      error instanceof Error ? error.message : 'Unknown rejection reason.',
    );
  }
}

function rethrowAsPersistenceError(error: unknown): never {
  if (
    error instanceof InvalidCashMovementError ||
    error instanceof InvalidIdError ||
    error instanceof InvalidMoneyError ||
    error instanceof InvalidOrderIdError ||
    error instanceof InvalidOrderTimestampError ||
    error instanceof InvalidShareQuantityError ||
    error instanceof InvalidUnitPriceError ||
    error instanceof NonPositiveAmountError ||
    error instanceof OrderSizeRequiredError
  ) {
    throw new OrderPersistenceError(error.message);
  }

  throw error;
}

function decimalToPlainString(value: Prisma.Decimal): string {
  const text = value.toFixed();

  if (text.includes('e') || text.includes('E')) {
    throw new OrderPersistenceError(
      'Decimal value cannot be represented without scientific notation.',
    );
  }

  return text;
}

function shareQuantityFromDecimal(value: Prisma.Decimal): ShareQuantity {
  const text = decimalToPlainString(value);
  const [whole, fraction] = text.split('.');

  if (fraction !== undefined && !/^0*$/.test(fraction)) {
    throw new OrderPersistenceError('Share size must be a whole number.');
  }

  const digits = whole?.replace(/^0+(?=\d)/, '') ?? '0';

  return ShareQuantity.of(BigInt(digits));
}
