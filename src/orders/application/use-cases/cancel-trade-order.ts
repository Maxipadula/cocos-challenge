import {
  canonicalDecimal,
  hashIdempotencyRequest,
} from '#shared/application/idempotency-hash.js';
import {
  IdempotencyConflictError,
  type IdempotencyStore,
  type StoredIdempotency,
} from '#shared/application/idempotency-store.js';
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from '#shared/application/json.js';
import type { UnitOfWork } from '#shared/application/unit-of-work.js';

import type {
  TradeOrder,
  TradeSide,
} from '../../domain/entities/trade-order.js';
import { OrderNotCancellableError } from '../../domain/errors/order-errors.js';
import type { OrderId } from '../../domain/value-objects/order-id.js';
import { ShareQuantity } from '../../domain/value-objects/share-quantity.js';
import type { UserId } from '../../domain/value-objects/user-id.js';
import type { OrderRepository } from '../ports/order-repository.js';
import type { UserLock } from '../ports/user-lock.js';

export const CANCEL_TRADE_ORDER = 'orders.cancel-trade';

const TRADE_SIDES = ['BUY', 'SELL'] as const;

export class InvalidIdempotencyResultError extends Error {
  constructor() {
    super('Stored idempotency result is invalid.');
    this.name = 'InvalidIdempotencyResultError';
  }
}

export type CancelTradeOrderCommand = {
  readonly userId: UserId;
  readonly orderId: OrderId;
  readonly idempotencyKey: string;
};

export type CancelledTradeOrder = {
  readonly id: string;
  readonly userId: string;
  readonly instrumentId: string;
  readonly side: TradeSide;
  readonly type: 'LIMIT';
  readonly status: 'CANCELLED';
  readonly size: string;
  readonly price: string;
  readonly placedAt: string;
};

export type CancelTradeOrderResult =
  | { readonly outcome: 'CANCELLED'; readonly order: CancelledTradeOrder }
  | { readonly outcome: 'NOT_FOUND' }
  | { readonly outcome: 'NOT_CANCELLABLE' };

export class CancelTradeOrder {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: UnitOfWork,
    private readonly userLock: UserLock,
    private readonly orders: OrderRepository,
  ) {}

  async execute(
    command: CancelTradeOrderCommand,
  ): Promise<CancelTradeOrderResult> {
    const requestHash = cancelTradeOrderRequestHash(command);
    const replay = resolveStored(
      await this.idempotency.find(command.userId, command.idempotencyKey),
      requestHash,
    );

    if (replay) {
      return replay;
    }

    return this.unitOfWork.run(() =>
      this.cancelInsideTransaction(command, requestHash),
    );
  }

  private async cancelInsideTransaction(
    command: CancelTradeOrderCommand,
    requestHash: string,
  ): Promise<CancelTradeOrderResult> {
    await this.userLock.acquire(command.userId);
    const raced = resolveStored(
      await this.idempotency.find(command.userId, command.idempotencyKey),
      requestHash,
    );

    if (raced) {
      return raced;
    }

    const current = await this.orders.findTradeForUpdate(
      command.userId,
      command.orderId,
    );
    const result = await this.applyCancellation(current);

    await this.idempotency.save({
      userId: command.userId,
      idempotencyKey: command.idempotencyKey,
      operation: CANCEL_TRADE_ORDER,
      requestHash,
      result: cancelTradeOrderResultToJson(result),
    });

    return result;
  }

  private async applyCancellation(
    current: TradeOrder | null,
  ): Promise<CancelTradeOrderResult> {
    if (!current) {
      return { outcome: 'NOT_FOUND' };
    }

    const cancelled = cancelIfAllowed(current);

    if (cancelled === 'NOT_CANCELLABLE') {
      return { outcome: 'NOT_CANCELLABLE' };
    }

    await this.orders.update(cancelled);
    return { outcome: 'CANCELLED', order: toCancelledTradeOrder(cancelled) };
  }
}

function cancelIfAllowed(order: TradeOrder): TradeOrder | 'NOT_CANCELLABLE' {
  try {
    return order.cancel();
  } catch (error) {
    if (error instanceof OrderNotCancellableError) {
      return 'NOT_CANCELLABLE';
    }

    throw error;
  }
}

function resolveStored(
  stored: StoredIdempotency | null,
  requestHash: string,
): CancelTradeOrderResult | null {
  if (!stored) {
    return null;
  }

  if (
    stored.operation !== CANCEL_TRADE_ORDER ||
    stored.requestHash !== requestHash
  ) {
    throw new IdempotencyConflictError();
  }

  return cancelTradeOrderResultFromJson(stored.result);
}

export function cancelTradeOrderRequestHash(
  command: CancelTradeOrderCommand,
): string {
  return hashIdempotencyRequest(CANCEL_TRADE_ORDER, {
    orderId: command.orderId,
    userId: command.userId,
  });
}

function toCancelledTradeOrder(order: TradeOrder): CancelledTradeOrder {
  return {
    id: order.id,
    userId: order.userId,
    instrumentId: order.instrumentId,
    side: order.side,
    type: 'LIMIT',
    status: 'CANCELLED',
    size: order.size.toBigInt().toString(),
    price: canonicalDecimal(order.price.multiply(ShareQuantity.of(1n))),
    placedAt: order.placedAt.toISOString(),
  };
}

export function cancelTradeOrderResultToJson(
  result: CancelTradeOrderResult,
): JsonObject {
  if (result.outcome !== 'CANCELLED') {
    return { outcome: result.outcome };
  }

  return {
    order: {
      id: result.order.id,
      instrumentId: result.order.instrumentId,
      placedAt: result.order.placedAt,
      price: result.order.price,
      side: result.order.side,
      size: result.order.size,
      status: result.order.status,
      type: result.order.type,
      userId: result.order.userId,
    },
    outcome: 'CANCELLED',
  };
}

export function cancelTradeOrderResultFromJson(
  value: JsonValue,
): CancelTradeOrderResult {
  if (!isJsonObject(value)) {
    throw new InvalidIdempotencyResultError();
  }

  if (value.outcome === 'NOT_FOUND' || value.outcome === 'NOT_CANCELLABLE') {
    return { outcome: value.outcome };
  }

  if (value.outcome !== 'CANCELLED' || !isJsonObject(value.order)) {
    throw new InvalidIdempotencyResultError();
  }

  const order = value.order;

  if (order.type !== 'LIMIT' || order.status !== 'CANCELLED') {
    throw new InvalidIdempotencyResultError();
  }

  return {
    outcome: 'CANCELLED',
    order: {
      id: requiredString(order.id),
      userId: requiredString(order.userId),
      instrumentId: requiredString(order.instrumentId),
      side: oneOf(order.side, TRADE_SIDES),
      type: 'LIMIT',
      status: 'CANCELLED',
      size: requiredString(order.size),
      price: requiredString(order.price),
      placedAt: requiredString(order.placedAt),
    },
  };
}

function requiredString(value: JsonValue | undefined): string {
  if (typeof value !== 'string') {
    throw new InvalidIdempotencyResultError();
  }

  return value;
}

function oneOf<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new InvalidIdempotencyResultError();
  }

  return value as T;
}
