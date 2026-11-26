import { describe, expect, it } from 'vitest';

import { InvalidMoneyError } from '#shared/domain/errors/value-object-errors.js';
import { Money } from '#shared/domain/value-objects/money.js';

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

  it('accepts 20 integer digits and 18 fractional digits', () => {
    const integer = '9'.repeat(20);
    const fraction = '1'.repeat(18);

    expect(Money.parse(integer).toDecimalString()).toBe(integer);
    expect(Money.parse(integer).integerDigitCount()).toBe(20);
    expect(Money.parse(`0.${fraction}`).toDecimalString()).toBe(
      `0.${fraction}`,
    );
  });

  it('rejects 21 integer digits and 19 fractional digits', () => {
    expect(() => Money.parse(`1${'0'.repeat(20)}`)).toThrow(InvalidMoneyError);
    expect(() => Money.parse(`-${'1'}${'0'.repeat(20)}`)).toThrow(
      InvalidMoneyError,
    );
    expect(() => Money.parse(`0.${'1'.repeat(19)}`)).toThrow(InvalidMoneyError);
  });

  it('accepts a negative amount inside the integer limit', () => {
    const amount = Money.parse(`-${'9'.repeat(20)}.50`);

    expect(amount.toDecimalString()).toBe(`-${'9'.repeat(20)}.50`);
    expect(amount.isNegative()).toBe(true);
  });

  it('ignores leading zeros when counting integer digits', () => {
    expect(Money.parse(`000${'9'.repeat(20)}`).toDecimalString()).toBe(
      '9'.repeat(20),
    );
    expect(Money.parse('000').toDecimalString()).toBe('0');
    expect(Money.parse('000.10').toDecimalString()).toBe('0.10');
    expect(() => Money.parse(`0001${'0'.repeat(20)}`)).toThrow(
      InvalidMoneyError,
    );
  });

  it('adds values past the storage limit without truncating the sum', () => {
    const sum = Money.parse('9'.repeat(20)).add(Money.parse('1'));

    expect(sum.toDecimalString()).toBe(`1${'0'.repeat(20)}`);
    expect(sum.integerDigitCount()).toBe(21);
  });

  it('rebuilds an aggregate larger than the storage limit', () => {
    const sum = Money.parse('9'.repeat(20)).add(Money.parse('9'.repeat(20)));
    const restored = Money.fromCalculation(sum.toDecimalString());
    const settled = Money.fromCalculation(`-${'9'.repeat(21)}`);
    const committed = Money.fromCalculation('9'.repeat(21));
    const available = settled.subtract(committed);

    expect(restored.toDecimalString()).toBe(sum.toDecimalString());
    expect(restored.equals(sum)).toBe(true);
    expect(available.toDecimalString()).toBe(
      (-(10n ** 21n - 1n) * 2n).toString(),
    );
    expect(available.isNegative()).toBe(true);
    expect(() => Money.parse(sum.toDecimalString())).toThrow(InvalidMoneyError);
    expect(() => Money.fromCalculation(`0.${'1'.repeat(19)}`)).toThrow(
      InvalidMoneyError,
    );
    expect(() => Money.fromCalculation('1e21')).toThrow(InvalidMoneyError);
  });
});
