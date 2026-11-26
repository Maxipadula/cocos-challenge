import { describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';

import { InvalidUnitPriceError } from '#orders/domain/errors/order-errors.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { UnitPrice } from '#orders/domain/value-objects/unit-price.js';

describe('UnitPrice', () => {
  it('rejects a zero or negative price', () => {
    expect(() => UnitPrice.parse('0.00')).toThrow(InvalidUnitPriceError);
    expect(() => UnitPrice.parse('-1.00')).toThrow(InvalidUnitPriceError);
  });

  it('multiplies a whole share count exactly', () => {
    const cost = UnitPrice.parse('33.33').multiply(ShareQuantity.of(3n));

    expect(cost.toDecimalString()).toBe('99.99');
  });

  it('floors the number of shares an amount can buy', () => {
    const price = UnitPrice.parse('33.33');

    expect(price.floorShares(Money.parse('100.00')).toBigInt()).toBe(3n);
    expect(price.floorShares(Money.parse('0.99')).toBigInt()).toBe(0n);
  });

  it('floors across different scales without losing the represented amounts', () => {
    const shares = UnitPrice.parse('10.00').floorShares(Money.parse('25.000'));

    expect(shares.toBigInt()).toBe(2n);
  });
});
