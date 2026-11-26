import { InvalidIdError } from '../errors/value-object-errors.js';

declare const userIdBrand: unique symbol;
declare const instrumentIdBrand: unique symbol;

export type UserId = number & { readonly [userIdBrand]: never };
export type InstrumentId = number & { readonly [instrumentIdBrand]: never };

export function userId(value: number): UserId {
  assertId(value);
  return value as UserId;
}

export function instrumentId(value: number): InstrumentId {
  assertId(value);
  return value as InstrumentId;
}

function assertId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidIdError();
  }
}
