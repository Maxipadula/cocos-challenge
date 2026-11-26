import { describe, expect, it } from 'vitest';
import { InvalidMoneyError } from '../../../../../src/shared/domain/errors/value-object-errors.js';
import { Money } from '../../../../../src/shared/domain/value-objects/money.js';

describe('Money', () => {
  it('adds decimal values without binary floating point error', () => {
    const sum = Money.parse('0.10').add(Money.parse('0.20'));

    expect(sum.toDecimalString()).toBe('0.30');
    expect(sum.equals(Money.parse('0.30'))).toBe(true);
  });

  it('aligns different scales without rounding', () => {
    const sum = Money.parse('10.5').add(Money.parse('0.50'));

    expect(sum.toDecimalString()).toBe('11.00');
    expect(sum.scale).toBe(2);
    expect(Money.parse('10.5').equals(Money.parse('10.50'))).toBe(true);
  });

  it('allows a negative result from subtraction', () => {
    const result = Money.parse('1.00').subtract(Money.parse('1.25'));

    expect(result.toDecimalString()).toBe('-0.25');
    expect(result.isNegative()).toBe(true);
  });

  it('rejects values that are not decimal amounts', () => {
    expect(() => Money.parse('1e2')).toThrow(InvalidMoneyError);
    expect(() => Money.parse('10.555')).not.toThrow();
    expect(Money.parse('10.555').toDecimalString()).toBe('10.555');
  });

  it('divides by aligning scales and flooring the integer quotient', () => {
    expect(Money.parse('100.00').floorDivide(Money.parse('33.33'))).toBe(3n);
    expect(Money.parse('25.000').floorDivide(Money.parse('10.00'))).toBe(2n);
  });
});
