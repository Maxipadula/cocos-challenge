import { Injectable } from '@nestjs/common';

import { uuid, type Uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  type AccountPortfolioSnapshot,
  OrdersPortfolioDataProvider,
} from '../../application/orders-portfolio-data.js';
import { accountHoldings } from '../../domain/services/account-holdings.js';
import { OrderPersistenceError } from './order-persistence.error.js';
import {
  reconstituteStoredOrder,
  type StoredOrderRow,
} from './order-row.mapper.js';

type SnapshotRow = {
  account_id: string;
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

    return {
      accountId: uuid(first.account_id),
      settledCash: holdings.settledCash.toDecimalString(),
      committedCash: holdings.committedCash.toDecimalString(),
      positions: holdings.positions.map((position) => ({
        instrumentId: uuid(position.instrumentId),
        quantity: position.quantity.toString(),
      })),
    };
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
