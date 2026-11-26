import { uuid, type Uuid } from '#shared/domain/value-objects/uuid.js';

declare const userIdBrand: unique symbol;

export type UserId = Uuid & { readonly [userIdBrand]: never };

export function userId(value: string): UserId {
  return uuid(value) as UserId;
}
