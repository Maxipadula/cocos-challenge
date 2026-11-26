import {
  instrumentId,
  userId,
} from '../../../../src/shared/domain/value-objects/ids.js';
import { ShareQuantity } from '../../../../src/shared/domain/value-objects/share-quantity.js';
import { UnitPrice } from '../../../../src/shared/domain/value-objects/unit-price.js';
import { orderId } from '../../../../src/orders/domain/value-objects/order-id.js';

export const placedAt = new Date('2026-01-15T15:00:00.000Z');
export const owner = userId(7);
export const stock = instrumentId(20);
export const peso = instrumentId(1);

export function identity(id: number, size: bigint) {
  return {
    id: orderId(id),
    userId: owner,
    instrumentId: stock,
    size: ShareQuantity.of(size),
    placedAt,
  };
}

export function price(value: string): UnitPrice {
  return UnitPrice.parse(value);
}
