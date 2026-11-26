import { describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';

import { Account } from '#orders/domain/entities/account.js';
import {
  ExcessReservationReleaseError,
  NonPositiveAmountError,
  ReservationNotPersistableError,
} from '#orders/domain/errors/order-errors.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';

import { account, fixtureUuid, stock } from '../order-fixture.js';

const other = instrumentId(fixtureUuid(21));

describe('Account', () => {
  it('reserves and releases cash without changing the original account', () => {
    const opened = Account.open(account);
    const reserved = opened.reserveCash(Money.parse('5000.00'));
    const released = reserved.releaseCash(Money.parse('2000.00'));

    expect(opened.reservedCash.isZero()).toBe(true);
    expect(reserved.reservedCash.toDecimalString()).toBe('5000.00');
    expect(released.reservedCash.toDecimalString()).toBe('3000.00');
  });

  it('accumulates share reservations by instrument and drops a zero balance', () => {
    const reserved = Account.open(account)
      .reserveShares(stock, ShareQuantity.of(2n))
      .reserveShares(stock, ShareQuantity.of(3n))
      .reserveShares(other, ShareQuantity.of(7n));
    const released = reserved.releaseShares(stock, ShareQuantity.of(5n));

    expect(reserved.reservedSharesOf(stock)).toBe(5n);
    expect(reserved.reservedSharesOf(other)).toBe(7n);
    expect(released.reservedSharesOf(stock)).toBe(0n);
    expect(released.reservedSharePositions()).toEqual([
      { instrumentId: other, quantity: 7n },
    ]);
  });

  it('rejects a release above the reserved amount and a non-positive reservation', () => {
    const reserved = Account.open(account).reserveCash(Money.parse('10.00'));

    expect(() => reserved.releaseCash(Money.parse('10.01'))).toThrow(
      ExcessReservationReleaseError,
    );
    expect(() => reserved.releaseShares(stock, ShareQuantity.of(1n))).toThrow(
      ExcessReservationReleaseError,
    );
    expect(() => reserved.reserveCash(Money.zero())).toThrow(
      NonPositiveAmountError,
    );
    expect(() => reserved.reserveShares(stock, ShareQuantity.zero())).toThrow(
      NonPositiveAmountError,
    );
    expect(reserved.reservedCash.toDecimalString()).toBe('10.00');
  });

  it('calculates available resources from settled balances', () => {
    const reserved = Account.open(account)
      .reserveCash(Money.parse('5000'))
      .reserveShares(stock, ShareQuantity.of(5n));

    expect(reserved.availableCash(Money.parse('10000')).toDecimalString()).toBe(
      '5000',
    );
    expect(reserved.availableCash(Money.parse('4000')).toDecimalString()).toBe(
      '-1000',
    );
    expect(reserved.availableShares(stock, 10n)).toBe(5n);
    expect(reserved.availableShares(stock, 4n)).toBe(0n);
    expect(reserved.availableShares(other, 4n)).toBe(4n);
  });

  it('rejects a reservation that cannot be stored', () => {
    const opened = Account.open(account);
    const almostCash = opened.reserveCash(Money.parse('9'.repeat(20)));
    const almostShares = Account.reconstitute({
      id: account,
      reservedCash: Money.zero(),
      reservedShares: [{ instrumentId: stock, quantity: 10n ** 38n - 1n }],
    });

    expect(() => almostCash.reserveCash(Money.parse('1'))).toThrow(
      ReservationNotPersistableError,
    );
    expect(() =>
      almostShares.reserveShares(stock, ShareQuantity.of(1n)),
    ).toThrow(ReservationNotPersistableError);
    expect(() =>
      Account.reconstitute({
        id: account,
        reservedCash: Money.parse('-1'),
        reservedShares: [],
      }),
    ).toThrow(ReservationNotPersistableError);
    expect(almostCash.reservedCash.toDecimalString()).toBe('9'.repeat(20));
  });
});
