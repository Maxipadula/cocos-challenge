import type { TradeOrder } from '../../domain/entities/trade-order.js';
import type { AccountEntry } from '../../domain/services/availability.js';
import type { UserId } from '../../domain/value-objects/user-id.js';

export abstract class OrderRepository {
  abstract findByUser(userId: UserId): Promise<readonly AccountEntry[]>;

  abstract add(order: TradeOrder): Promise<void>;
}
