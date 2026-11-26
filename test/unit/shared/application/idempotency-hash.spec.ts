import { describe, expect, it } from 'vitest';
import {
  canonicalDecimal,
  hashIdempotencyRequest,
} from '../../../../src/shared/application/idempotency-hash.js';
import { Money } from '../../../../src/shared/domain/value-objects/money.js';

describe('idempotency hash', () => {
  it('treats equal money amounts with different scales as the same value', () => {
    expect(canonicalDecimal(Money.parse('10.50'))).toBe('10.5');
    expect(canonicalDecimal(Money.parse('10.5'))).toBe('10.5');
    expect(canonicalDecimal(Money.parse('10.00'))).toBe('10');
    expect(canonicalDecimal(Money.parse('10'))).toBe('10');
  });

  it('is stable when object keys arrive in a different order', () => {
    const left = hashIdempotencyRequest('orders.submit-trade', {
      side: 'BUY',
      type: 'MARKET',
    });
    const right = hashIdempotencyRequest('orders.submit-trade', {
      type: 'MARKET',
      side: 'BUY',
    });

    expect(left).toBe(right);
  });

  it('changes when the operation changes', () => {
    const payload = { userId: 'user' };

    expect(hashIdempotencyRequest('orders.submit-trade', payload)).not.toBe(
      hashIdempotencyRequest('orders.cancel-trade', payload),
    );
  });
});
