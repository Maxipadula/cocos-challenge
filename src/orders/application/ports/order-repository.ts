import type { UserId } from '../../../shared/domain/value-objects/ids.js';
import type { AccountEntry } from '../../domain/services/availability.js';
import type { TradeOrder } from '../../domain/entities/trade-order.js';

export abstract class OrderRepository {
  abstract findByUser(userId: UserId): Promise<readonly AccountEntry[]>;

  abstract add(order: TradeOrder): Promise<void>;
}
