import { parseUuid } from './uuid.js';

declare const userIdBrand: unique symbol;
declare const instrumentIdBrand: unique symbol;

export type UserId = string & { readonly [userIdBrand]: never };
export type InstrumentId = string & { readonly [instrumentIdBrand]: never };

export function userId(value: string): UserId {
  return parseUuid(value) as UserId;
}

export function instrumentId(value: string): InstrumentId {
  return parseUuid(value) as InstrumentId;
}
