import {
  MAX_MONEY_INTEGER_DIGITS,
  Money,
} from '#shared/domain/value-objects/money.js';

import {
  ExcessReservationReleaseError,
  NonPositiveAmountError,
  ReservationNotPersistableError,
} from '../errors/order-errors.js';
import type { AccountId } from '../value-objects/account-id.js';
import type { InstrumentId } from '../value-objects/instrument-id.js';
import type { ShareQuantity } from '../value-objects/share-quantity.js';

const MAX_PERSISTED_SHARES = 10n ** 38n;

export type ReservedShares = {
  readonly instrumentId: InstrumentId;
  readonly quantity: bigint;
};

export class Account {
  private constructor(
    readonly id: AccountId,
    readonly reservedCash: Money,
    private readonly shares: ReadonlyMap<InstrumentId, bigint>,
  ) {}

  static open(id: AccountId): Account {
    return new Account(id, Money.zero(), new Map());
  }

  static reconstitute(props: {
    readonly id: AccountId;
    readonly reservedCash: Money;
    readonly reservedShares: readonly ReservedShares[];
  }): Account {
    assertPersistableCash(props.reservedCash);

    if (props.reservedCash.isNegative()) {
      throw new ReservationNotPersistableError(
        'Reserved cash cannot be negative.',
      );
    }

    const shares = new Map<InstrumentId, bigint>();

    for (const position of props.reservedShares) {
      if (shares.has(position.instrumentId)) {
        throw new ReservationNotPersistableError(
          'Reserved shares cannot repeat an instrument.',
        );
      }

      assertPersistableShares(position.quantity);

      if (position.quantity <= 0n) {
        throw new ReservationNotPersistableError(
          'Reserved share quantity must be positive.',
        );
      }

      shares.set(position.instrumentId, position.quantity);
    }

    return new Account(props.id, props.reservedCash, shares);
  }

  reserveCash(amount: Money): Account {
    assertPositiveCash(amount);
    const reservedCash = this.reservedCash.add(amount);
    assertPersistableCash(reservedCash);

    return new Account(this.id, reservedCash, this.shares);
  }

  releaseCash(amount: Money): Account {
    assertPositiveCash(amount);

    if (this.reservedCash.lessThan(amount)) {
      throw new ExcessReservationReleaseError();
    }

    return new Account(
      this.id,
      this.reservedCash.subtract(amount),
      this.shares,
    );
  }

  reserveShares(instrumentId: InstrumentId, quantity: ShareQuantity): Account {
    if (quantity.isZero()) {
      throw new NonPositiveAmountError();
    }

    const reserved =
      (this.shares.get(instrumentId) ?? 0n) + quantity.toBigInt();
    assertPersistableShares(reserved);
    const shares = new Map(this.shares);
    shares.set(instrumentId, reserved);

    return new Account(this.id, this.reservedCash, shares);
  }

  releaseShares(instrumentId: InstrumentId, quantity: ShareQuantity): Account {
    if (quantity.isZero()) {
      throw new NonPositiveAmountError();
    }

    const current = this.shares.get(instrumentId) ?? 0n;

    if (current < quantity.toBigInt()) {
      throw new ExcessReservationReleaseError();
    }

    const shares = new Map(this.shares);
    const remaining = current - quantity.toBigInt();

    if (remaining === 0n) {
      shares.delete(instrumentId);
    } else {
      shares.set(instrumentId, remaining);
    }

    return new Account(this.id, this.reservedCash, shares);
  }

  reservedSharesOf(instrumentId: InstrumentId): bigint {
    return this.shares.get(instrumentId) ?? 0n;
  }

  reservedSharePositions(): readonly ReservedShares[] {
    return [...this.shares.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([instrumentId, quantity]) => ({ instrumentId, quantity }));
  }

  availableCash(settledCash: Money): Money {
    return settledCash.subtract(this.reservedCash);
  }

  availableShares(instrumentId: InstrumentId, settledQuantity: bigint): bigint {
    const available = settledQuantity - this.reservedSharesOf(instrumentId);

    return available < 0n ? 0n : available;
  }
}

function assertPositiveCash(amount: Money): void {
  if (!amount.isPositive()) {
    throw new NonPositiveAmountError();
  }
}

function assertPersistableCash(amount: Money): void {
  if (amount.integerDigitCount() > MAX_MONEY_INTEGER_DIGITS) {
    throw new ReservationNotPersistableError();
  }
}

function assertPersistableShares(quantity: bigint): void {
  if (quantity >= MAX_PERSISTED_SHARES) {
    throw new ReservationNotPersistableError();
  }
}
