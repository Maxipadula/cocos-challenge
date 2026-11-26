import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { orderId } from '#orders/domain/value-objects/order-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { UnitPrice } from '#orders/domain/value-objects/unit-price.js';
import { userId } from '#orders/domain/value-objects/user-id.js';

export const placedAt = new Date('2026-01-15T15:00:00.000Z');
export const owner = userId(fixtureUuid(7));
export const stock = instrumentId(fixtureUuid(20));
export const peso = instrumentId(fixtureUuid(1));

export function fixtureUuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

export function identity(id: number, size: bigint) {
  return {
    id: orderId(fixtureUuid(id)),
    userId: owner,
    instrumentId: stock,
    size: ShareQuantity.of(size),
    placedAt,
  };
}

export function price(value: string): UnitPrice {
  return UnitPrice.parse(value);
}
