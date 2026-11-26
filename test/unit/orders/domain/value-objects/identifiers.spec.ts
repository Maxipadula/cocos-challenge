import { describe, expect, it } from 'vitest';

import { InvalidOrderIdError } from '#orders/domain/errors/order-errors.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { orderId } from '#orders/domain/value-objects/order-id.js';
import { userId } from '#orders/domain/value-objects/user-id.js';

const value = '123e4567-e89b-12d3-a456-426614174000';

describe('order identifiers', () => {
  it('brands a UUID for the user, the instrument and the order', () => {
    expect(userId(value)).toBe(value);
    expect(instrumentId(value.toUpperCase())).toBe(value);
    expect(orderId(value)).toBe(value);
  });

  it('rejects an order id that is not a UUID', () => {
    expect(() => orderId('4')).toThrow(InvalidOrderIdError);
    expect(() => userId('4')).toThrow();
    expect(() => instrumentId('4')).toThrow();
  });
});
