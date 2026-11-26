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
import type { UuidGenerator } from '#shared/application/uuid-generator.js';

import type { InstrumentQueries } from '#instruments/application/instrument-queries.js';

import type {
  TradeOrder,
  TradeSide,
  TradeStatus,
  TradeType,
} from '../../domain/entities/trade-order.js';
import {
  decideTradeOrder,
  type DecideTradeOrderCommand,
  type TradeSizing,
} from '../../domain/services/decide-trade-order.js';
import type { InstrumentId } from '../../domain/value-objects/instrument-id.js';
import { orderId, type OrderId } from '../../domain/value-objects/order-id.js';
import type { RejectionReason } from '../../domain/value-objects/rejection-reason.js';
import { ShareQuantity } from '../../domain/value-objects/share-quantity.js';
import { UnitPrice } from '../../domain/value-objects/unit-price.js';
import type { UserId } from '../../domain/value-objects/user-id.js';
import type { OrderRepository } from '../ports/order-repository.js';
import type { UserLock } from '../ports/user-lock.js';

export const SUBMIT_TRADE_ORDER = 'orders.submit-trade';

const TRADE_SIDES = ['BUY', 'SELL'] as const;
const TRADE_TYPES = ['MARKET', 'LIMIT'] as const;
const TRADE_STATUSES = ['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const;
const REJECTION_REASONS = ['INSUFFICIENT_CASH', 'INSUFFICIENT_SHARES'] as const;

export class InstrumentNotFoundError extends Error {
  constructor() {
    super('Instrument was not found.');
    this.name = 'InstrumentNotFoundError';
  }
}

export class InstrumentNotTradableError extends Error {
  constructor() {
    super('Currency instruments cannot be traded.');
    this.name = 'InstrumentNotTradableError';
  }
}

export class MarketPriceUnavailableError extends Error {
  constructor() {
    super('Market order requires a latest close price.');
    this.name = 'MarketPriceUnavailableError';
  }
}

export class InvalidIdempotencyResultError extends Error {
  constructor() {
    super('Stored idempotency result is invalid.');
    this.name = 'InvalidIdempotencyResultError';
  }
}

export type SubmitTradeOrderCommand = {
  readonly userId: UserId;
  readonly instrumentId: InstrumentId;
  readonly side: TradeSide;
  readonly idempotencyKey: string;
  readonly sizing: TradeSizing;
} & (
  | { readonly type: 'MARKET' }
  | { readonly type: 'LIMIT'; readonly limitPrice: UnitPrice }
);

export type SubmittedTradeOrder = {
  readonly id: string;
  readonly userId: string;
  readonly instrumentId: string;
  readonly side: TradeSide;
  readonly type: TradeType;
  readonly status: TradeStatus;
  readonly size: string;
  readonly price: string;
  readonly rejectionReason: RejectionReason | null;
  readonly placedAt: string;
};

export class SubmitTradeOrder {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly instruments: InstrumentQueries,
    private readonly unitOfWork: UnitOfWork,
    private readonly userLock: UserLock,
    private readonly orders: OrderRepository,
    private readonly ids: UuidGenerator,
  ) {}

  async execute(
    command: SubmitTradeOrderCommand,
  ): Promise<SubmittedTradeOrder> {
    const requestHash = submitTradeOrderRequestHash(command);
    const existing = await this.idempotency.find(
      command.userId,
      command.idempotencyKey,
    );
    const replay = resolveStored(existing, requestHash);

    if (replay) {
      return replay;
    }

    const instrument = await this.instruments.findById(command.instrumentId);

    if (!instrument) {
      throw new InstrumentNotFoundError();
    }

    if (instrument.type === 'MONEDA') {
      throw new InstrumentNotTradableError();
    }

    const executionPrice =
      command.type === 'MARKET'
        ? await this.requireClose(command.instrumentId)
        : null;

    return this.unitOfWork.run(() =>
      this.decideAndPersist(command, requestHash, executionPrice),
    );
  }

  private async requireClose(instrumentId: InstrumentId): Promise<UnitPrice> {
    const close = await this.instruments.latestClose(instrumentId);

    if (!close) {
      throw new MarketPriceUnavailableError();
    }

    return UnitPrice.parse(close);
  }

  private async decideAndPersist(
    command: SubmitTradeOrderCommand,
    requestHash: string,
    executionPrice: UnitPrice | null,
  ): Promise<SubmittedTradeOrder> {
    await this.userLock.acquire(command.userId);
    const raced = resolveStored(
      await this.idempotency.find(command.userId, command.idempotencyKey),
      requestHash,
    );

    if (raced) {
      return raced;
    }

    const entries = await this.orders.findByUser(command.userId);
    const id = orderId(this.ids.generate());
    const placedAt = new Date();
    const decision = decideTradeOrder(
      entries,
      toDomainCommand(command, id, placedAt, executionPrice),
    );
    await this.orders.add(decision);
    const result = toSubmittedTradeOrder(decision);

    await this.idempotency.save({
      userId: command.userId,
      idempotencyKey: command.idempotencyKey,
      operation: SUBMIT_TRADE_ORDER,
      requestHash,
      result: submittedTradeOrderToJson(result),
    });

    return result;
  }
}

function resolveStored(
  stored: StoredIdempotency | null,
  requestHash: string,
): SubmittedTradeOrder | null {
  if (!stored) {
    return null;
  }

  if (
    stored.operation !== SUBMIT_TRADE_ORDER ||
    stored.requestHash !== requestHash
  ) {
    throw new IdempotencyConflictError();
  }

  return submittedTradeOrderFromJson(stored.result);
}

export function submitTradeOrderRequestHash(
  command: SubmitTradeOrderCommand,
): string {
  return hashIdempotencyRequest(SUBMIT_TRADE_ORDER, commandPayload(command));
}

function commandPayload(command: SubmitTradeOrderCommand): JsonObject {
  const payload: Record<string, JsonValue> = {
    instrumentId: command.instrumentId,
    side: command.side,
    sizing: sizingPayload(command.sizing),
    type: command.type,
    userId: command.userId,
  };

  if (command.type === 'LIMIT') {
    payload.limitPrice = canonicalPrice(command.limitPrice);
  }

  return payload;
}

function sizingPayload(sizing: TradeSizing): JsonObject {
  if (sizing.kind === 'QUANTITY') {
    return {
      kind: 'QUANTITY',
      quantity: sizing.quantity.toBigInt().toString(),
    };
  }

  return {
    amount: canonicalDecimal(sizing.amount),
    kind: 'AMOUNT',
  };
}

function canonicalPrice(price: UnitPrice): string {
  return canonicalDecimal(price.multiply(ShareQuantity.of(1n)));
}

function toDomainCommand(
  command: SubmitTradeOrderCommand,
  id: OrderId,
  placedAt: Date,
  executionPrice: UnitPrice | null,
): DecideTradeOrderCommand {
  const base = {
    id,
    userId: command.userId,
    instrumentId: command.instrumentId,
    side: command.side,
    placedAt,
    sizing: command.sizing,
  };

  if (command.type === 'MARKET') {
    if (!executionPrice) {
      throw new MarketPriceUnavailableError();
    }

    return { ...base, type: 'MARKET', executionPrice };
  }

  return { ...base, type: 'LIMIT', limitPrice: command.limitPrice };
}

function toSubmittedTradeOrder(order: TradeOrder): SubmittedTradeOrder {
  return {
    id: order.id,
    userId: order.userId,
    instrumentId: order.instrumentId,
    side: order.side,
    type: order.type,
    status: order.status,
    size: order.size.toBigInt().toString(),
    price: canonicalPrice(order.price),
    rejectionReason: order.rejectionReason,
    placedAt: order.placedAt.toISOString(),
  };
}

export function submittedTradeOrderToJson(
  result: SubmittedTradeOrder,
): JsonObject {
  return {
    id: result.id,
    instrumentId: result.instrumentId,
    placedAt: result.placedAt,
    price: result.price,
    rejectionReason: result.rejectionReason,
    side: result.side,
    size: result.size,
    status: result.status,
    type: result.type,
    userId: result.userId,
  };
}

export function submittedTradeOrderFromJson(
  value: JsonValue,
): SubmittedTradeOrder {
  if (!isJsonObject(value)) {
    throw new InvalidIdempotencyResultError();
  }

  return {
    id: requiredString(value.id),
    userId: requiredString(value.userId),
    instrumentId: requiredString(value.instrumentId),
    side: oneOf(value.side, TRADE_SIDES),
    type: oneOf(value.type, TRADE_TYPES),
    status: oneOf(value.status, TRADE_STATUSES),
    size: requiredString(value.size),
    price: requiredString(value.price),
    rejectionReason: optionalReason(value.rejectionReason),
    placedAt: requiredString(value.placedAt),
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

function optionalReason(value: JsonValue | undefined): RejectionReason | null {
  if (value === null) {
    return null;
  }

  if (
    typeof value === 'string' &&
    REJECTION_REASONS.includes(value as RejectionReason)
  ) {
    return value as RejectionReason;
  }

  throw new InvalidIdempotencyResultError();
}
