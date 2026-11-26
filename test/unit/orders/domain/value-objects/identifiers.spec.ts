import { describe, expect, it } from 'vitest';

import { userId, type UserId } from '#orders/application/types/user-id.js';
import { InvalidOrderIdError } from '#orders/domain/errors/order-errors.js';
import {
  accountId,
  type AccountId,
} from '#orders/domain/value-objects/account-id.js';
import {
  instrumentId,
  type InstrumentId,
} from '#orders/domain/value-objects/instrument-id.js';
import {
  orderId,
  type OrderId,
} from '#orders/domain/value-objects/order-id.js';

const value = '123e4567-e89b-12d3-a456-426614174000';

type Distinct<Left, Right> = [Left] extends [Right] ? false : true;

describe('order identifiers', () => {
  it('brands a UUID for the account, the instrument and the order', () => {
    expect(accountId(value)).toBe(value);
    expect(accountId(value.toUpperCase())).toBe(value);
    expect(instrumentId(value.toUpperCase())).toBe(value);
    expect(orderId(value)).toBe(value);
    expect(userId(value.toUpperCase())).toBe(value);
  });

  it('rejects an identifier that is not a UUID', () => {
    expect(() => accountId('4')).toThrow();
    expect(() => orderId('4')).toThrow(InvalidOrderIdError);
    expect(() => userId('4')).toThrow();
    expect(() => instrumentId('4')).toThrow();
  });

  it('keeps account ids distinct from the other identifiers', () => {
    const accountIsNotUser: Distinct<AccountId, UserId> = true;
    const accountIsNotOrder: Distinct<AccountId, OrderId> = true;
    const accountIsNotInstrument: Distinct<AccountId, InstrumentId> = true;

    expect(accountIsNotUser).toBe(true);
    expect(accountIsNotOrder).toBe(true);
    expect(accountIsNotInstrument).toBe(true);
  });
});
