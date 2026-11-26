import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  IdempotencyStore,
  type NewIdempotencyRecord,
  type StoredIdempotency,
} from '../../application/idempotency-store.js';
import type { JsonValue } from '../../application/json.js';
import { UuidGenerator } from '../../application/uuid-generator.js';
import { uuid, type Uuid } from '../../domain/value-objects/uuid.js';
import { PrismaClientProvider } from './prisma-client.provider.js';

@Injectable()
export class PrismaIdempotencyStore extends IdempotencyStore {
  constructor(
    private readonly clients: PrismaClientProvider,
    private readonly ids: UuidGenerator,
  ) {
    super();
  }

  override async find(
    userId: Uuid,
    idempotencyKey: string,
  ): Promise<StoredIdempotency | null> {
    const row = await this.clients.getClient().idempotencyRecord.findUnique({
      where: {
        userId_idempotencyKey: { userId, idempotencyKey },
      },
      select: {
        operation: true,
        requestHash: true,
        result: true,
      },
    });

    if (!row) {
      return null;
    }

    return {
      operation: row.operation,
      requestHash: row.requestHash,
      result: fromPrismaJson(row.result),
    };
  }

  override async save(record: NewIdempotencyRecord): Promise<void> {
    if (record.result === null) {
      throw new Error('Idempotency result must not be null.');
    }

    const completedAt = new Date();

    await this.clients.getTransactionClient().idempotencyRecord.create({
      data: {
        id: uuid(this.ids.generate()),
        userId: record.userId,
        idempotencyKey: record.idempotencyKey,
        operation: record.operation,
        requestHash: record.requestHash,
        result: toInputJson(record.result),
        createdAt: completedAt,
        completedAt,
      },
    });
  }
}

function toInputJson(value: Exclude<JsonValue, null>): Prisma.InputJsonValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === null ? null : toInputJson(item)));
  }

  const object: { [key: string]: Prisma.InputJsonValue | null } = {};

  for (const [key, nested] of Object.entries(value)) {
    object[key] = nested === null ? null : toInputJson(nested);
  }

  return object;
}

function fromPrismaJson(value: Prisma.JsonValue): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => fromPrismaJson(item));
  }

  const object: { [key: string]: JsonValue } = {};

  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) {
      object[key] = fromPrismaJson(nested);
    }
  }

  return object;
}
