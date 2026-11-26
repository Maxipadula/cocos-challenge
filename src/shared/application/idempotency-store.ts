import type { UserId } from '../domain/value-objects/ids.js';
import type { JsonValue } from './json.js';

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was reused with a different request.');
    this.name = 'IdempotencyConflictError';
  }
}

export type StoredIdempotency = {
  readonly operation: string;
  readonly requestHash: string;
  readonly result: JsonValue;
};

export type NewIdempotencyRecord = {
  readonly userId: UserId;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly requestHash: string;
  readonly result: JsonValue;
};

export abstract class IdempotencyStore {
  abstract find(
    userId: UserId,
    idempotencyKey: string,
  ): Promise<StoredIdempotency | null>;

  abstract save(record: NewIdempotencyRecord): Promise<void>;
}
