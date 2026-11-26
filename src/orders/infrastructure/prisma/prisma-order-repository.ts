import { Injectable } from '@nestjs/common';

import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';

import { Prisma } from '../../../generated/prisma/client.js';
import { OrderRepository } from '../../application/ports/order-repository.js';
import { TradeOrder } from '../../domain/entities/trade-order.js';
import type { AccountEntry } from '../../domain/services/availability.js';
import type { AccountId } from '../../domain/value-objects/account-id.js';
import type { OrderId } from '../../domain/value-objects/order-id.js';
import { ShareQuantity } from '../../domain/value-objects/share-quantity.js';
import { OrderPersistenceError } from './order-persistence.error.js';
import {
  isTradeSide,
  reconstituteStoredOrder,
  type StoredOrderRow,
} from './order-row.mapper.js';

@Injectable()
export class PrismaOrderRepository extends OrderRepository {
  constructor(private readonly clients: PrismaClientProvider) {
    super();
  }

  override async findByAccount(
    accountId: AccountId,
  ): Promise<readonly AccountEntry[]> {
    const rows = await this.clients.getTransactionClient().$queryRaw<
      StoredOrderRow[]
    >`
      SELECT
        orders.*,
        instruments.ticker AS instrument_ticker,
        instruments.type AS instrument_type
      FROM orders
      INNER JOIN instruments
        ON instruments.id = orders.instrument_id
      WHERE orders.account_id = ${accountId}::uuid
      ORDER BY orders.placed_at ASC, orders.id ASC
    `;

    return rows.map((row) => reconstituteStoredOrder(row));
  }

  override async add(order: TradeOrder): Promise<void> {
    const price = order.price.multiply(ShareQuantity.of(1n)).toDecimalString();

    await this.clients.getTransactionClient().order.create({
      data: {
        id: order.id,
        accountId: order.accountId,
        instrumentId: order.instrumentId,
        side: order.side,
        size: new Prisma.Decimal(order.size.toBigInt().toString()),
        price: new Prisma.Decimal(price),
        type: order.type,
        status: order.status,
        rejectionReason: order.rejectionReason,
        placedAt: order.placedAt,
      },
    });
  }

  override async findTradeForUpdate(
    accountId: AccountId,
    orderId: OrderId,
  ): Promise<TradeOrder | null> {
    const rows = await this.clients.getTransactionClient().$queryRaw<
      StoredOrderRow[]
    >`
      SELECT
        orders.id,
        orders.account_id,
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
      FROM orders
      INNER JOIN instruments ON instruments.id = orders.instrument_id
      WHERE orders.account_id = ${accountId}::uuid
        AND orders.id = ${orderId}::uuid
        AND orders.side IN ('BUY', 'SELL')
      FOR UPDATE OF orders
    `;
    const row = rows[0];

    if (!row || !isTradeSide(row.side)) {
      return null;
    }

    const entry = reconstituteStoredOrder(row);

    return entry instanceof TradeOrder ? entry : null;
  }

  override async update(order: TradeOrder): Promise<void> {
    if (order.type !== 'LIMIT' || order.status !== 'CANCELLED') {
      throw new OrderPersistenceError(
        'Only a cancelled limit order can be updated.',
      );
    }

    const updated = await this.clients.getTransactionClient().order.updateMany({
      where: {
        id: order.id,
        accountId: order.accountId,
        side: { in: ['BUY', 'SELL'] },
        type: 'LIMIT',
        status: 'NEW',
      },
      data: { status: 'CANCELLED' },
    });

    if (updated.count !== 1) {
      throw new OrderPersistenceError('Order update did not change any row.');
    }
  }
}
