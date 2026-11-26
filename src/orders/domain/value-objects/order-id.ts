import { InvalidIdError } from '../../../shared/domain/errors/value-object-errors.js';
import { parseUuid } from '../../../shared/domain/value-objects/uuid.js';
import { InvalidOrderIdError } from '../errors/order-errors.js';

declare const orderIdBrand: unique symbol;

export type OrderId = string & { readonly [orderIdBrand]: never };

export function orderId(value: string): OrderId {
  try {
    return parseUuid(value) as OrderId;
  } catch (error) {
    if (error instanceof InvalidIdError) {
      throw new InvalidOrderIdError();
    }

    throw error;
  }
}
