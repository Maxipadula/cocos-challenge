import { InvalidShareQuantityError } from '../errors/order-errors.js';

export class ShareQuantity {
  private constructor(private readonly value: bigint) {}

  static of(value: bigint): ShareQuantity {
    if (value < 0n) {
      throw new InvalidShareQuantityError();
    }

    return new ShareQuantity(value);
  }

  static zero(): ShareQuantity {
    return new ShareQuantity(0n);
  }

  isZero(): boolean {
    return this.value === 0n;
  }

  lessThan(other: ShareQuantity): boolean {
    return this.value < other.value;
  }

  add(other: ShareQuantity): ShareQuantity {
    return new ShareQuantity(this.value + other.value);
  }

  toBigInt(): bigint {
    return this.value;
  }
}
