import { InvalidMoneyError } from '../errors/value-object-errors.js';

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const MAX_SCALE = 18;
export const MAX_MONEY_INTEGER_DIGITS = 20;

export class Money {
  private constructor(
    private readonly units: bigint,
    readonly scale: number,
  ) {}

  static parse(value: string): Money {
    const parsed = Money.readDecimal(value);

    if (parsed.integerDigits > MAX_MONEY_INTEGER_DIGITS) {
      throw new InvalidMoneyError();
    }

    return parsed.money;
  }

  static fromCalculation(value: string): Money {
    return Money.readDecimal(value).money;
  }

  static zero(scale = 0): Money {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new InvalidMoneyError();
    }

    return new Money(0n, scale);
  }

  add(other: Money): Money {
    const aligned = Money.align(this, other);
    return new Money(aligned.left + aligned.right, aligned.scale);
  }

  subtract(other: Money): Money {
    const aligned = Money.align(this, other);
    return new Money(aligned.left - aligned.right, aligned.scale);
  }

  negate(): Money {
    return new Money(-this.units, this.scale);
  }

  multiplyInteger(quantity: bigint): Money {
    return new Money(this.units * quantity, this.scale);
  }

  floorDivide(divisor: Money): bigint {
    if (!divisor.isPositive()) {
      throw new InvalidMoneyError('Divisor must be positive.');
    }

    const aligned = Money.align(this, divisor);
    return aligned.left / aligned.right;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isPositive(): boolean {
    return this.units > 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  equals(other: Money): boolean {
    return this.compare(other) === 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  compare(other: Money): -1 | 0 | 1 {
    const aligned = Money.align(this, other);

    if (aligned.left < aligned.right) {
      return -1;
    }

    if (aligned.left > aligned.right) {
      return 1;
    }

    return 0;
  }

  integerDigitCount(): number {
    if (this.units === 0n) {
      return 1;
    }

    const digits = (this.units < 0n ? -this.units : this.units).toString();
    const whole = digits.length - this.scale;

    return whole > 0 ? whole : 1;
  }

  toDecimalString(): string {
    const negative = this.units < 0n;
    const digits = (negative ? -this.units : this.units).toString();

    if (this.scale === 0) {
      return negative ? `-${digits}` : digits;
    }

    const padded = digits.padStart(this.scale + 1, '0');
    const whole = padded.slice(0, -this.scale);
    const fraction = padded.slice(-this.scale);
    const body = `${whole}.${fraction}`;
    return negative ? `-${body}` : body;
  }

  private static readDecimal(value: string): {
    money: Money;
    integerDigits: number;
  } {
    const match = DECIMAL_PATTERN.exec(value.trim());

    if (!match) {
      throw new InvalidMoneyError();
    }

    const fraction = match[3] ?? '';
    const integerDigits = match[2].replace(/^0+/, '').length;

    if (fraction.length > MAX_SCALE) {
      throw new InvalidMoneyError();
    }

    const sign = match[1] === '-' ? -1n : 1n;

    return {
      money: new Money(sign * BigInt(match[2] + fraction), fraction.length),
      integerDigits,
    };
  }

  private static align(
    left: Money,
    right: Money,
  ): { left: bigint; right: bigint; scale: number } {
    if (left.scale === right.scale) {
      return { left: left.units, right: right.units, scale: left.scale };
    }

    if (left.scale > right.scale) {
      return {
        left: left.units,
        right: right.units * 10n ** BigInt(left.scale - right.scale),
        scale: left.scale,
      };
    }

    return {
      left: left.units * 10n ** BigInt(right.scale - left.scale),
      right: right.units,
      scale: right.scale,
    };
  }
}
