import { InvalidRejectionReasonError } from '../errors/order-errors.js';

export const rejectionReasons = [
  'INSUFFICIENT_CASH',
  'INSUFFICIENT_SHARES',
] as const;

export type RejectionReason = (typeof rejectionReasons)[number];

export function rejectionReason(value: string): RejectionReason {
  if (value === 'INSUFFICIENT_CASH' || value === 'INSUFFICIENT_SHARES') {
    return value;
  }

  throw new InvalidRejectionReasonError();
}
