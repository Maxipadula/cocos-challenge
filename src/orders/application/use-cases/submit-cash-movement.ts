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
import { Money } from '#shared/domain/value-objects/money.js';

import type { InstrumentQueries } from '#instruments/application/instrument-queries.js';

import {
  CashMovement,
  type CashSide,
  type CashStatus,
} from '../../domain/entities/cash-movement.js';
import { accountHoldings } from '../../domain/services/account-holdings.js';
import {
  instrumentId,
  type InstrumentId,
} from '../../domain/value-objects/instrument-id.js';
import { orderId } from '../../domain/value-objects/order-id.js';
import type { RejectionReason } from '../../domain/value-objects/rejection-reason.js';
import { AccountNotFoundError } from '../errors/account-not-found.error.js';
import type { AccountLock } from '../ports/account-lock.js';
import type { AccountRepository } from '../ports/account-repository.js';
import type { OrderRepository } from '../ports/order-repository.js';
import type { UserId } from '../types/user-id.js';

export const SUBMIT_CASH_MOVEMENT = 'orders.submit-cash';

const ARS_TICKER = 'ARS';
const CURRENCY_TYPE = 'MONEDA';
const CASH_SIDES = ['CASH_IN', 'CASH_OUT'] as const;
const CASH_STATUSES = ['FILLED', 'REJECTED'] as const;

export class CashCurrencyUnavailableError extends Error {
  constructor() {
    super('ARS currency instrument was not found.');
    this.name = 'CashCurrencyUnavailableError';
  }
}

export class InvalidIdempotencyResultError extends Error {
  constructor() {
    super('Stored idempotency result is invalid.');
    this.name = 'InvalidIdempotencyResultError';
  }
}

export type SubmitCashMovementCommand = {
  readonly userId: UserId;
  readonly side: CashSide;
  readonly amount: string;
  readonly idempotencyKey: string;
};

export type SubmittedCashMovement = {
  readonly id: string;
  readonly accountId: string;
  readonly instrumentId: string;
  readonly side: CashSide;
  readonly status: CashStatus;
  readonly amount: string;
  readonly rejectionReason: RejectionReason | null;
  readonly placedAt: string;
};

export class SubmitCashMovement {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly instruments: InstrumentQueries,
    private readonly unitOfWork: UnitOfWork,
    private readonly accountLock: AccountLock,
    private readonly orders: OrderRepository,
    private readonly ids: UuidGenerator,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(
    command: SubmitCashMovementCommand,
  ): Promise<SubmittedCashMovement> {
    const amount = Money.parse(command.amount);
    const requestHash = submitCashMovementRequestHash(
      command.userId,
      command.side,
      amount,
    );
    const replay = resolveStored(
      await this.idempotency.find(command.userId, command.idempotencyKey),
      requestHash,
    );

    if (replay) {
      return replay;
    }

    const currency = await this.currency();

    return this.unitOfWork.run(() =>
      this.persist(command, amount, currency, requestHash),
    );
  }

  private async currency(): Promise<InstrumentId> {
    const instrument = await this.instruments.findByTicker(ARS_TICKER);

    if (
      !instrument ||
      instrument.ticker !== ARS_TICKER ||
      instrument.type !== CURRENCY_TYPE
    ) {
      throw new CashCurrencyUnavailableError();
    }

    return instrumentId(instrument.id);
  }

  private async persist(
    command: SubmitCashMovementCommand,
    amount: Money,
    currencyId: InstrumentId,
    requestHash: string,
  ): Promise<SubmittedCashMovement> {
    const accountId = await this.accountLock.acquireForUser(command.userId);
    const raced = resolveStored(
      await this.idempotency.find(command.userId, command.idempotencyKey),
      requestHash,
    );

    if (raced) {
      return raced;
    }

    const account = await this.accounts.findById(accountId);

    if (!account) {
      throw new AccountNotFoundError();
    }

    const movement =
      command.side === 'CASH_IN'
        ? CashMovement.cashIn({
            id: orderId(this.ids.generate()),
            accountId,
            instrumentId: currencyId,
            amount,
            placedAt: new Date(),
          })
        : CashMovement.cashOut({
            id: orderId(this.ids.generate()),
            accountId,
            instrumentId: currencyId,
            amount,
            placedAt: new Date(),
            availableCash: account.availableCash(
              accountHoldings(await this.orders.findByAccount(accountId))
                .settledCash,
            ),
          });

    await this.orders.addCashMovement(movement);
    const result = toSubmittedCashMovement(movement);

    await this.idempotency.save({
      userId: command.userId,
      idempotencyKey: command.idempotencyKey,
      operation: SUBMIT_CASH_MOVEMENT,
      requestHash,
      result: submittedCashMovementToJson(result),
    });

    return result;
  }
}

export function submitCashMovementRequestHash(
  userId: UserId,
  side: CashSide,
  amount: Money,
): string {
  return hashIdempotencyRequest(SUBMIT_CASH_MOVEMENT, {
    amount: canonicalDecimal(amount),
    side,
    userId,
  });
}

function toSubmittedCashMovement(
  movement: CashMovement,
): SubmittedCashMovement {
  return {
    id: movement.id,
    accountId: movement.accountId,
    instrumentId: movement.instrumentId,
    side: movement.side,
    status: movement.cashStatus,
    amount: canonicalDecimal(movement.amount),
    rejectionReason: movement.rejectionReason,
    placedAt: movement.placedAt.toISOString(),
  };
}

export function submittedCashMovementToJson(
  result: SubmittedCashMovement,
): JsonObject {
  return {
    accountId: result.accountId,
    amount: result.amount,
    id: result.id,
    instrumentId: result.instrumentId,
    placedAt: result.placedAt,
    rejectionReason: result.rejectionReason,
    side: result.side,
    status: result.status,
  };
}

export function submittedCashMovementFromJson(
  value: JsonValue,
): SubmittedCashMovement {
  if (!isJsonObject(value)) {
    throw new InvalidIdempotencyResultError();
  }

  return {
    id: requiredString(value.id),
    accountId: requiredString(value.accountId),
    instrumentId: requiredString(value.instrumentId),
    side: oneOf(value.side, CASH_SIDES),
    status: oneOf(value.status, CASH_STATUSES),
    amount: requiredString(value.amount),
    rejectionReason:
      value.rejectionReason === null
        ? null
        : value.rejectionReason === 'INSUFFICIENT_CASH'
          ? 'INSUFFICIENT_CASH'
          : invalidResult(),
    placedAt: requiredString(value.placedAt),
  };
}

function resolveStored(
  stored: StoredIdempotency | null,
  requestHash: string,
): SubmittedCashMovement | null {
  if (!stored) {
    return null;
  }

  if (
    stored.operation !== SUBMIT_CASH_MOVEMENT ||
    stored.requestHash !== requestHash
  ) {
    throw new IdempotencyConflictError();
  }

  return submittedCashMovementFromJson(stored.result);
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

function invalidResult(): never {
  throw new InvalidIdempotencyResultError();
}
