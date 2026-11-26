import { InvalidMoneyError } from '#shared/domain/errors/value-object-errors.js';
import {
  MAX_MONEY_INTEGER_DIGITS,
  Money,
} from '#shared/domain/value-objects/money.js';

import {
  InvalidCashMovementError,
  InvalidOrderTimestampError,
  NonPositiveAmountError,
} from '../errors/order-errors.js';
import type { AccountId } from '../value-objects/account-id.js';
import type { InstrumentId } from '../value-objects/instrument-id.js';
import type { OrderId } from '../value-objects/order-id.js';
import type { RejectionReason } from '../value-objects/rejection-reason.js';

export type CashSide = 'CASH_IN' | 'CASH_OUT';
export type CashStatus = 'FILLED' | 'REJECTED';

type CashMovementProps = {
  readonly id: OrderId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  readonly amount: Money;
  readonly placedAt: Date;
};

export class CashMovement {
  private constructor(
    readonly id: OrderId,
    readonly accountId: AccountId,
    readonly instrumentId: InstrumentId,
    readonly side: CashSide,
    readonly amount: Money,
    readonly placedAt: Date,
    private readonly status: CashStatus,
    private readonly reason: RejectionReason | null,
  ) {}

  static cashIn(props: CashMovementProps): CashMovement {
    assertPositiveAmount(props.amount);
    assertPersistableAmount(props.amount);
    return new CashMovement(
      props.id,
      props.accountId,
      props.instrumentId,
      'CASH_IN',
      props.amount,
      copyDate(props.placedAt),
      'FILLED',
      null,
    );
  }

  static cashOut(
    props: CashMovementProps & { readonly availableCash: Money },
  ): CashMovement {
    assertPositiveAmount(props.amount);
    assertPersistableAmount(props.amount);
    const rejected = props.availableCash.lessThan(props.amount);

    return new CashMovement(
      props.id,
      props.accountId,
      props.instrumentId,
      'CASH_OUT',
      props.amount,
      copyDate(props.placedAt),
      rejected ? 'REJECTED' : 'FILLED',
      rejected ? 'INSUFFICIENT_CASH' : null,
    );
  }

  static reconstitute(
    props: CashMovementProps & {
      readonly side: CashSide;
      readonly status: CashStatus;
      readonly rejectionReason: RejectionReason | null;
    },
  ): CashMovement {
    assertPositiveAmount(props.amount);
    assertPersistableAmount(props.amount);

    if (!isStoredCashState(props.side, props.status, props.rejectionReason)) {
      throw new InvalidCashMovementError();
    }

    return new CashMovement(
      props.id,
      props.accountId,
      props.instrumentId,
      props.side,
      props.amount,
      copyDate(props.placedAt),
      props.status,
      props.rejectionReason,
    );
  }

  get cashStatus(): CashStatus {
    return this.status;
  }

  get rejectionReason(): RejectionReason | null {
    return this.reason;
  }

  settledCashDelta(): Money {
    if (this.status !== 'FILLED') {
      return Money.zero(this.amount.scale);
    }

    return this.side === 'CASH_IN' ? this.amount : this.amount.negate();
  }

  committedCash(): Money {
    return Money.zero(this.amount.scale);
  }
}

function isStoredCashState(
  side: CashSide,
  status: CashStatus,
  reason: RejectionReason | null,
): boolean {
  if (side === 'CASH_IN') {
    return status === 'FILLED' && reason === null;
  }

  if (status === 'FILLED') {
    return reason === null;
  }

  return status === 'REJECTED' && reason === 'INSUFFICIENT_CASH';
}

function assertPositiveAmount(amount: Money): void {
  if (!amount.isPositive()) {
    throw new NonPositiveAmountError();
  }
}

function assertPersistableAmount(amount: Money): void {
  if (amount.integerDigitCount() > MAX_MONEY_INTEGER_DIGITS) {
    throw new InvalidMoneyError();
  }
}

function copyDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new InvalidOrderTimestampError();
  }

  return new Date(value.getTime());
}
