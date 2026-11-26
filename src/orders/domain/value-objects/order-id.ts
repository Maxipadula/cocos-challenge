import { InvalidOrderIdError } from '../errors/order-errors.js';

declare const orderIdBrand: unique symbol;

export type OrderId = number & { readonly [orderIdBrand]: never };

export function orderId(value: number): OrderId {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidOrderIdError();
  }

  return value as OrderId;
}
