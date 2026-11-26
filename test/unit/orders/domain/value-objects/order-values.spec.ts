import { describe, expect, it } from 'vitest';
import {
  InvalidOrderIdError,
  InvalidRejectionReasonError,
} from '../../../../../src/orders/domain/errors/order-errors.js';
import { orderId } from '../../../../../src/orders/domain/value-objects/order-id.js';
import { rejectionReason } from '../../../../../src/orders/domain/value-objects/rejection-reason.js';

describe('order value objects', () => {
  it('accepts the known rejection reasons and a positive order id', () => {
    expect(rejectionReason('INSUFFICIENT_CASH')).toBe('INSUFFICIENT_CASH');
    expect(rejectionReason('INSUFFICIENT_SHARES')).toBe('INSUFFICIENT_SHARES');
    expect(orderId(4)).toBe(4);
  });

  it('rejects an unknown reason and an invalid order id', () => {
    expect(() => rejectionReason('EXPIRED')).toThrow(
      InvalidRejectionReasonError,
    );
    expect(() => orderId(0)).toThrow(InvalidOrderIdError);
  });
});
