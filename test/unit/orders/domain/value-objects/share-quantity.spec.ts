import { describe, expect, it } from 'vitest';

import { InvalidShareQuantityError } from '#orders/domain/errors/order-errors.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';

describe('ShareQuantity', () => {
  it('accepts zero and adds whole shares', () => {
    const total = ShareQuantity.zero().add(ShareQuantity.of(4n));

    expect(total.toBigInt()).toBe(4n);
    expect(ShareQuantity.of(4n).lessThan(ShareQuantity.of(5n))).toBe(true);
  });

  it('rejects a negative quantity', () => {
    expect(() => ShareQuantity.of(-1n)).toThrow(InvalidShareQuantityError);
  });
});
