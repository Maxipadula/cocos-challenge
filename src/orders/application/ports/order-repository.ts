import type { TradeOrder } from '../../domain/entities/trade-order.js';
import type { AccountEntry } from '../../domain/services/availability.js';
import type { OrderId } from '../../domain/value-objects/order-id.js';
import type { UserId } from '../../domain/value-objects/user-id.js';

export abstract class OrderRepository {
  abstract findByUser(userId: UserId): Promise<readonly AccountEntry[]>;

  abstract findTradeForUpdate(
    userId: UserId,
    orderId: OrderId,
  ): Promise<TradeOrder | null>;

  abstract add(order: TradeOrder): Promise<void>;

  abstract update(order: TradeOrder): Promise<void>;
}
