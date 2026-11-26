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

  it('accepts the largest persistable quantity and rejects the next integer', () => {
    const maximum = 10n ** 20n - 1n;

    expect(ShareQuantity.of(maximum).toBigInt()).toBe(maximum);
    expect(() => ShareQuantity.of(10n ** 20n)).toThrow(
      InvalidShareQuantityError,
    );
  });

  it('keeps an integer above the safe number range exact', () => {
    const quantity = 2n ** 53n + 1n;

    expect(ShareQuantity.of(quantity).toBigInt()).toBe(quantity);
  });

  it('adds past the storage limit without truncating the sum', () => {
    const sum = ShareQuantity.of(10n ** 20n - 1n).add(ShareQuantity.of(1n));

    expect(sum.toBigInt()).toBe(10n ** 20n);
  });
});
