import { describe, expect, it } from 'vitest';
import { Money } from '../../../../../src/shared/domain/value-objects/money.js';
import { CashMovement } from '../../../../../src/orders/domain/entities/cash-movement.js';
import { NonPositiveAmountError } from '../../../../../src/orders/domain/errors/order-errors.js';
import { availableCash } from '../../../../../src/orders/domain/services/availability.js';
import { identity, peso } from '../order-fixture.js';

function cash(id: number, amount: string) {
  return {
    ...identity(id, 1n),
    instrumentId: peso,
    amount: Money.parse(amount),
  };
}

describe('CashMovement', () => {
  it('fills a cash in and adds the amount', () => {
    const movement = CashMovement.cashIn(cash(1, '1500.00'));

    expect(movement.side).toBe('CASH_IN');
    expect(movement.cashStatus).toBe('FILLED');
    expect(movement.rejectionReason).toBeNull();
    expect(movement.settledCashDelta().toDecimalString()).toBe('1500.00');
    expect(movement.committedCash().isZero()).toBe(true);
  });

  it('fills a cash out when the available cash covers the amount', () => {
    const deposit = CashMovement.cashIn(cash(1, '100.00'));
    const movement = CashMovement.cashOut({
      ...cash(2, '40.50'),
      availableCash: availableCash([deposit]),
    });

    expect(movement.side).toBe('CASH_OUT');
    expect(movement.cashStatus).toBe('FILLED');
    expect(movement.rejectionReason).toBeNull();
    expect(movement.settledCashDelta().toDecimalString()).toBe('-40.50');
    expect(availableCash([deposit, movement]).toDecimalString()).toBe('59.50');
  });

  it('fills a cash out for the exact available amount, including a different scale', () => {
    const movement = CashMovement.cashOut({
      ...cash(2, '10.50'),
      availableCash: Money.parse('10.5'),
    });

    expect(movement.cashStatus).toBe('FILLED');
    expect(movement.rejectionReason).toBeNull();
  });

  it('rejects a cash out above the available cash without moving funds', () => {
    const deposit = CashMovement.cashIn(cash(1, '80.00'));
    const movement = CashMovement.cashOut({
      ...cash(2, '80.01'),
      availableCash: availableCash([deposit]),
    });

    expect(movement.cashStatus).toBe('REJECTED');
    expect(movement.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(movement.settledCashDelta().isZero()).toBe(true);
    expect(movement.committedCash().isZero()).toBe(true);
    expect(availableCash([deposit, movement]).toDecimalString()).toBe('80.00');
  });

  it('rejects a non-positive cash amount', () => {
    const available = Money.parse('100.00');

    expect(() => CashMovement.cashIn(cash(1, '0.00'))).toThrow(
      NonPositiveAmountError,
    );
    expect(() => CashMovement.cashIn(cash(1, '-1.00'))).toThrow(
      NonPositiveAmountError,
    );
    expect(() =>
      CashMovement.cashOut({ ...cash(2, '-5.00'), availableCash: available }),
    ).toThrow(NonPositiveAmountError);
  });
});
