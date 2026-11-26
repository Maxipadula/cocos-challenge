import { InvalidUnitPriceError } from '../errors/value-object-errors.js';
import { Money } from './money.js';
import { ShareQuantity } from './share-quantity.js';

export class UnitPrice {
  private constructor(private readonly amount: Money) {}

  static parse(value: string): UnitPrice {
    const amount = Money.parse(value);

    if (!amount.isPositive()) {
      throw new InvalidUnitPriceError();
    }

    return new UnitPrice(amount);
  }

  get scale(): number {
    return this.amount.scale;
  }

  multiply(quantity: ShareQuantity): Money {
    return this.amount.multiplyInteger(quantity.toBigInt());
  }

  floorShares(amount: Money): ShareQuantity {
    if (amount.isNegative()) {
      throw new InvalidUnitPriceError(
        'Share count cannot be derived from a negative amount.',
      );
    }

    return ShareQuantity.of(amount.floorDivide(this.amount));
  }
}
