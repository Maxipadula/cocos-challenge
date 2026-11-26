import { Injectable } from '@nestjs/common';

import {
  InvalidIdError,
  InvalidMoneyError,
} from '#shared/domain/errors/value-object-errors.js';
import { Money } from '#shared/domain/value-objects/money.js';
import { uuid, type Uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  type AccountPortfolioSnapshot,
  OrdersPortfolioDataProvider,
} from '../../application/orders-portfolio-data.js';
import { Account } from '../../domain/entities/account.js';
import { ReservationNotPersistableError } from '../../domain/errors/order-errors.js';
import { accountHoldings } from '../../domain/services/account-holdings.js';
import { accountId } from '../../domain/value-objects/account-id.js';
import {
  instrumentId,
  type InstrumentId,
} from '../../domain/value-objects/instrument-id.js';
import { OrderPersistenceError } from './order-persistence.error.js';
import {
  reconstituteStoredOrder,
  type StoredOrderRow,
} from './order-row.mapper.js';

type SnapshotRow = {
  account_id: string;
  reserved_cash: Prisma.Decimal;
  reserved_positions: unknown;
  id: string | null;
  instrument_id: string | null;
  side: string | null;
  size: Prisma.Decimal | null;
  price: Prisma.Decimal | null;
  type: string | null;
  status: string | null;
  rejection_reason: string | null;
  placed_at: Date | null;
  instrument_ticker: string | null;
  instrument_type: string | null;
};

@Injectable()
export class PrismaOrdersPortfolioData extends OrdersPortfolioDataProvider {
  constructor(private readonly clients: PrismaClientProvider) {
    super();
  }

  override async findByUserId(
    userId: Uuid,
  ): Promise<AccountPortfolioSnapshot | null> {
    const rows = await this.clients.getClient().$queryRaw<SnapshotRow[]>`
      SELECT
        accounts.id AS account_id,
        accounts.reserved_cash,
        (
          SELECT COALESCE(json_agg(json_build_object(
            'instrument_id', positions.instrument_id,
            'quantity', positions.quantity::text
          ) ORDER BY positions.instrument_id), '[]'::json)
          FROM account_reserved_positions AS positions
          WHERE positions.account_id = accounts.id
        ) AS reserved_positions,
        orders.id,
        orders.instrument_id,
        orders.side,
        orders.size,
        orders.price,
        orders.type,
        orders.status,
        orders.rejection_reason,
        orders.placed_at,
        instruments.ticker AS instrument_ticker,
        instruments.type AS instrument_type
      FROM accounts
      LEFT JOIN orders
        ON orders.account_id = accounts.id
      LEFT JOIN instruments
        ON instruments.id = orders.instrument_id
      WHERE accounts.user_id = ${userId}::uuid
      ORDER BY orders.placed_at ASC NULLS LAST, orders.id ASC NULLS LAST
    `;
    const first = rows[0];

    if (!first) {
      return null;
    }

    if (rows.some((row) => row.account_id !== first.account_id)) {
      throw new OrderPersistenceError(
        'Portfolio snapshot returned more than one account.',
      );
    }

    const holdings = accountHoldings(
      rows.flatMap((row) => {
        if (row.id === null) {
          return [];
        }

        return [reconstituteStoredOrder(storedOrder(row))];
      }),
    );
    const account = reconstituteAccount(first);
    const settledQuantities = new Map(
      holdings.positions.map((position) => [
        position.instrumentId,
        position.quantity,
      ]),
    );
    const instrumentIds = [
      ...new Set([
        ...settledQuantities.keys(),
        ...account
          .reservedSharePositions()
          .map((position) => position.instrumentId),
      ]),
    ].sort();

    return {
      accountId: uuid(first.account_id),
      settledCash: holdings.settledCash.toDecimalString(),
      reservedCash: account.reservedCash.toDecimalString(),
      availableCash: account
        .availableCash(holdings.settledCash)
        .toDecimalString(),
      positions: instrumentIds.map((id) => {
        const quantity = settledQuantities.get(id) ?? 0n;

        return {
          instrumentId: uuid(id),
          quantity: quantity.toString(),
          reservedQuantity: account.reservedSharesOf(id).toString(),
          availableQuantity: account.availableShares(id, quantity).toString(),
        };
      }),
    };
  }
}

function reconstituteAccount(row: SnapshotRow): Account {
  try {
    return Account.reconstitute({
      id: accountId(row.account_id),
      reservedCash: Money.parse(decimalToPlainString(row.reserved_cash)),
      reservedShares: readPositions(row.reserved_positions).map((position) => ({
        instrumentId: readInstrumentId(position.instrument_id),
        quantity: quantityFromText(position.quantity),
      })),
    });
  } catch (error) {
    if (
      error instanceof ReservationNotPersistableError ||
      error instanceof InvalidIdError ||
      error instanceof InvalidMoneyError
    ) {
      throw new OrderPersistenceError(error.message);
    }

    throw error;
  }
}

function storedOrder(row: SnapshotRow): StoredOrderRow {
  if (
    row.id === null ||
    row.instrument_id === null ||
    row.side === null ||
    row.size === null ||
    row.status === null ||
    row.placed_at === null ||
    row.instrument_ticker === null ||
    row.instrument_type === null
  ) {
    throw new OrderPersistenceError('Order row is incomplete.');
  }

  return {
    id: row.id,
    account_id: row.account_id,
    instrument_id: row.instrument_id,
    side: row.side,
    size: row.size,
    price: row.price,
    type: row.type,
    status: row.status,
    rejection_reason: row.rejection_reason,
    placed_at: row.placed_at,
    instrument_ticker: row.instrument_ticker,
    instrument_type: row.instrument_type,
  };
}

function readPositions(
  value: unknown,
): readonly { instrument_id: string; quantity: string }[] {
  const parsed = typeof value === 'string' ? parseJson(value) : value;

  if (!Array.isArray(parsed)) {
    throw new OrderPersistenceError('Reserved positions payload is invalid.');
  }

  return parsed.map((position) => {
    if (
      typeof position !== 'object' ||
      position === null ||
      !('instrument_id' in position) ||
      !('quantity' in position) ||
      typeof position.instrument_id !== 'string' ||
      typeof position.quantity !== 'string'
    ) {
      throw new OrderPersistenceError('Reserved position row is invalid.');
    }

    return {
      instrument_id: position.instrument_id,
      quantity: position.quantity,
    };
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new OrderPersistenceError('Reserved positions payload is invalid.');
  }
}

function readInstrumentId(value: string): InstrumentId {
  try {
    return instrumentId(value);
  } catch (error) {
    if (error instanceof InvalidIdError) {
      throw new OrderPersistenceError(error.message);
    }

    throw error;
  }
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

function quantityFromText(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);

  if (!match?.[1] || (match[2] !== undefined && !/^0*$/.test(match[2]))) {
    throw new OrderPersistenceError(
      'Reserved share quantity must be a whole number.',
    );
  }

  return BigInt(match[1].replace(/^0+(?=\d)/, '') || '0');
}
