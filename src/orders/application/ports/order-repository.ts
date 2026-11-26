import type { TradeOrder } from '../../domain/entities/trade-order.js';
import type { AccountEntry } from '../../domain/services/availability.js';
import type { AccountId } from '../../domain/value-objects/account-id.js';
import type { OrderId } from '../../domain/value-objects/order-id.js';

export abstract class OrderRepository {
  abstract findByAccount(
    accountId: AccountId,
  ): Promise<readonly AccountEntry[]>;

  abstract findTradeForUpdate(
    accountId: AccountId,
    orderId: OrderId,
  ): Promise<TradeOrder | null>;

  abstract add(order: TradeOrder): Promise<void>;

  abstract update(order: TradeOrder): Promise<void>;
}
