import { describe, expect, it } from 'vitest';

import {
  InvalidOrderIdError,
  InvalidRejectionReasonError,
} from '#orders/domain/errors/order-errors.js';
import { orderId } from '#orders/domain/value-objects/order-id.js';
import { rejectionReason } from '#orders/domain/value-objects/rejection-reason.js';

const id = '123e4567-e89b-12d3-a456-426614174000';

describe('order value objects', () => {
  it('accepts the known rejection reasons and a UUID order id', () => {
    expect(rejectionReason('INSUFFICIENT_CASH')).toBe('INSUFFICIENT_CASH');
    expect(rejectionReason('INSUFFICIENT_SHARES')).toBe('INSUFFICIENT_SHARES');
    expect(orderId(id.toUpperCase())).toBe(id);
  });

  it('rejects an unknown reason and an invalid order id', () => {
    expect(() => rejectionReason('EXPIRED')).toThrow(
      InvalidRejectionReasonError,
    );
    expect(() => orderId('4')).toThrow(InvalidOrderIdError);
  });
});
