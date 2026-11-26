import { uuid, type Uuid } from '#shared/domain/value-objects/uuid.js';

declare const accountIdBrand: unique symbol;

export type AccountId = Uuid & { readonly [accountIdBrand]: never };

export function accountId(value: string): AccountId {
  return uuid(value) as AccountId;
}
