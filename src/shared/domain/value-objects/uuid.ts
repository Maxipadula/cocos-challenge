import { InvalidIdError } from '../errors/value-object-errors.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

declare const uuidBrand: unique symbol;

export type Uuid = string & { readonly [uuidBrand]: never };

export function uuid(value: string): Uuid {
  const normalized = value.trim().toLowerCase();

  if (!UUID_PATTERN.test(normalized)) {
    throw new InvalidIdError();
  }

  return normalized as Uuid;
}
