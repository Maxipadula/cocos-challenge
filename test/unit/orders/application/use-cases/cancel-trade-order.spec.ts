import { describe, expect, it } from 'vitest';

import {
  IdempotencyConflictError,
  IdempotencyStore,
  type NewIdempotencyRecord,
  type StoredIdempotency,
} from '#shared/application/idempotency-store.js';
import { UnitOfWork } from '#shared/application/unit-of-work.js';

import { AccountNotFoundError } from '#orders/application/errors/account-not-found.error.js';
import { AccountLock } from '#orders/application/ports/account-lock.js';
import { AccountRepository } from '#orders/application/ports/account-repository.js';
import { OrderRepository } from '#orders/application/ports/order-repository.js';
import { type UserId, userId } from '#orders/application/types/user-id.js';
import {
  CANCEL_TRADE_ORDER,
  CancelTradeOrder,
  type CancelTradeOrderCommand,
  cancelTradeOrderRequestHash,
  type CancelTradeOrderResult,
  cancelTradeOrderResultFromJson,
  cancelTradeOrderResultToJson,
} from '#orders/application/use-cases/cancel-trade-order.js';
import { Account } from '#orders/domain/entities/account.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import { ExcessReservationReleaseError } from '#orders/domain/errors/order-errors.js';
import {
  accountId,
  type AccountId,
} from '#orders/domain/value-objects/account-id.js';
import type { OrderId } from '#orders/domain/value-objects/order-id.js';

import {
  account,
  fixtureUuid,
  identity,
  owner,
  placedAt,
  price,
  stock,
} from '../../domain/order-fixture.js';

type TransactionParticipant = {
  commit(): void;
  rollback(): void;
};

class RecordingUnitOfWork extends UnitOfWork {
  readonly participants: TransactionParticipant[] = [];

  constructor(private readonly events: string[]) {
    super();
  }

  active = false;

  override async run<T>(work: () => Promise<T>): Promise<T> {
    this.events.push('transaction');
    this.active = true;

    try {
      const result = await work();

      for (const participant of this.participants) {
        participant.commit();
      }

      return result;
    } catch (error) {
      for (const participant of this.participants) {
        participant.rollback();
      }

      throw error;
    } finally {
      this.active = false;
    }
  }
}

class MemoryIdempotencyStore extends IdempotencyStore {
  readonly saved: NewIdempotencyRecord[] = [];
  readonly committed: NewIdempotencyRecord[] = [];
  savedDuringTransaction = false;
  failOnSave = false;
  private pending: NewIdempotencyRecord[] = [];
  private readonly scripted: Array<StoredIdempotency | null> = [];

  constructor(
    private readonly events: string[],
    private readonly unitOfWork: RecordingUnitOfWork,
  ) {
    super();
  }

  script(...responses: Array<StoredIdempotency | null>): void {
    this.scripted.push(...responses);
  }

  override async find(): Promise<StoredIdempotency | null> {
    this.events.push('idempotency.find');
    return this.scripted.shift() ?? null;
  }

  override async save(record: NewIdempotencyRecord): Promise<void> {
    this.events.push('idempotency.save');

    if (this.failOnSave) {
      throw new Error('idempotency insert failed');
    }

    this.savedDuringTransaction = this.unitOfWork.active;
    this.saved.push(record);
    this.pending.push(record);
  }

  commit(): void {
    this.committed.push(...this.pending);
    this.pending = [];
  }

  rollback(): void {
    this.pending = [];
  }
}

class MemoryOrders extends OrderRepository {
  readonly updated: TradeOrder[] = [];
  readonly committed: TradeOrder[] = [];
  readonly lookups: Array<{ accountId: AccountId; orderId: OrderId }> = [];
  updatedDuringTransaction = false;
  found: TradeOrder | null = null;
  failOnFind = false;
  failOnUpdate = false;
  private pending: TradeOrder[] = [];

  constructor(
    private readonly events: string[],
    private readonly unitOfWork: RecordingUnitOfWork,
    private trade: TradeOrder | null,
  ) {
    super();
  }

  override async findByAccount(): Promise<readonly []> {
    throw new Error('CancelTradeOrder does not list the account.');
  }

  override async add(): Promise<void> {
    throw new Error('CancelTradeOrder does not insert an order.');
  }

  override async addCashMovement(): Promise<void> {
    throw new Error('CancelTradeOrder does not insert a cash movement.');
  }

  override async findTradeForUpdate(
    accountId: AccountId,
    orderId: OrderId,
  ): Promise<TradeOrder | null> {
    this.events.push('orders.findTradeForUpdate');
    this.lookups.push({ accountId, orderId });

    if (this.failOnFind) {
      throw new Error('order lookup failed');
    }

    if (
      !this.trade ||
      this.trade.accountId !== accountId ||
      this.trade.id !== orderId
    ) {
      this.found = null;
      return null;
    }

    this.found = this.trade;
    return this.trade;
  }

  override async update(order: TradeOrder): Promise<void> {
    this.events.push('orders.update');

    if (this.failOnUpdate) {
      throw new Error('order update failed');
    }

    this.updatedDuringTransaction = this.unitOfWork.active;
    this.updated.push(order);
    this.pending.push(order);
  }

  commit(): void {
    const last = this.pending.at(-1);

    if (last) {
      this.trade = last;
    }

    this.committed.push(...this.pending);
    this.pending = [];
  }

  rollback(): void {
    this.pending = [];
  }
}

class MemoryAccounts extends AccountRepository {
  readonly saved: Account[] = [];
  readonly committed: Account[] = [];
  failOnSave = false;
  missing = false;
  private pending: Account[] = [];

  constructor(
    private readonly events: string[],
    private current: Account,
  ) {
    super();
  }

  override async findById(id: AccountId): Promise<Account | null> {
    this.events.push('accounts.find');

    if (this.missing || id !== this.current.id) {
      return null;
    }

    return this.current;
  }

  override async save(next: Account): Promise<void> {
    this.events.push('accounts.save');

    if (this.failOnSave) {
      throw new Error('account save failed');
    }

    this.saved.push(next);
    this.pending.push(next);
  }

  commit(): void {
    const last = this.pending.at(-1);

    if (last) {
      this.current = last;
    }

    this.committed.push(...this.pending);
    this.pending = [];
  }

  rollback(): void {
    this.pending = [];
  }

  get state(): Account {
    return this.current;
  }
}

class MemoryAccountLock extends AccountLock {
  missing = false;
  acquiredDuringTransaction = false;

  constructor(
    private readonly events: string[],
    private readonly unitOfWork: RecordingUnitOfWork,
  ) {
    super();
  }

  override async acquireForUser(): Promise<AccountId> {
    this.events.push('lock');
    this.acquiredDuringTransaction = this.unitOfWork.active;

    if (this.missing) {
      throw new AccountNotFoundError();
    }

    return account;
  }
}

function openLimit(ownerAccount: AccountId = account): TradeOrder {
  return TradeOrder.limitOpen({
    ...identity(4, 3n),
    accountId: ownerAccount,
    side: 'BUY',
    price: price('10.50'),
  });
}

function harness(
  trade: TradeOrder | null = openLimit(),
  reserved: Account = initialReservation(trade),
) {
  const events: string[] = [];
  const unitOfWork = new RecordingUnitOfWork(events);
  const idempotency = new MemoryIdempotencyStore(events, unitOfWork);
  const orders = new MemoryOrders(events, unitOfWork, trade);
  const accounts = new MemoryAccounts(events, reserved);
  const accountLock = new MemoryAccountLock(events, unitOfWork);
  unitOfWork.participants.push(idempotency, orders, accounts);
  const useCase = new CancelTradeOrder(
    idempotency,
    unitOfWork,
    accountLock,
    orders,
    accounts,
  );

  return { events, idempotency, orders, accounts, accountLock, useCase };
}

function initialReservation(trade: TradeOrder | null): Account {
  if (
    !trade ||
    trade.accountId !== account ||
    trade.type !== 'LIMIT' ||
    trade.status !== 'NEW'
  ) {
    return Account.open(account);
  }

  if (trade.side === 'BUY') {
    return Account.open(account).reserveCash(trade.price.multiply(trade.size));
  }

  return Account.open(account).reserveShares(trade.instrumentId, trade.size);
}

function command(
  orderId: OrderId,
  idempotencyKey = 'client-key',
  user: UserId = owner,
): CancelTradeOrderCommand {
  return { userId: user, orderId, idempotencyKey };
}

function remembered(
  result: CancelTradeOrderResult,
  requestHash: string,
  operation = CANCEL_TRADE_ORDER,
): StoredIdempotency {
  return {
    operation,
    requestHash,
    result: cancelTradeOrderResultToJson(result),
  };
}

const cancelledResult: CancelTradeOrderResult = {
  outcome: 'CANCELLED',
  order: {
    id: fixtureUuid(4),
    accountId: account,
    instrumentId: stock,
    side: 'BUY',
    type: 'LIMIT',
    status: 'CANCELLED',
    size: '3',
    price: '10.5',
    placedAt: placedAt.toISOString(),
  },
};

describe('CancelTradeOrder', () => {
  it('replays the first read without opening a transaction', async () => {
    const original = openLimit();
    const { events, idempotency, orders, accounts, useCase } =
      harness(original);
    const request = command(original.id);
    idempotency.script(
      remembered(cancelledResult, cancelTradeOrderRequestHash(request)),
    );

    await expect(useCase.execute(request)).resolves.toEqual(cancelledResult);
    expect(events).toEqual(['idempotency.find']);
    expect(events).not.toContain('lock');
    expect(events).not.toContain('transaction');
    expect(orders.lookups).toEqual([]);
    expect(orders.updated).toEqual([]);
    expect(accounts.saved).toEqual([]);
    expect(idempotency.saved).toEqual([]);
  });

  it('rejects a conflicting first read without opening a transaction', async () => {
    const original = openLimit();
    const { events, idempotency, orders, useCase } = harness(original);
    const request = command(original.id);
    idempotency.script(
      remembered(
        { outcome: 'NOT_FOUND' },
        cancelTradeOrderRequestHash(
          command(original.id, 'client-key', userId(fixtureUuid(8))),
        ),
      ),
    );

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(events).not.toContain('transaction');
    expect(orders.lookups).toEqual([]);
  });

  it('replays the second read without searching for the order', async () => {
    const original = openLimit();
    const { events, idempotency, orders, useCase } = harness(original);
    const request = command(original.id);
    idempotency.script(
      null,
      remembered(cancelledResult, cancelTradeOrderRequestHash(request)),
    );

    await expect(useCase.execute(request)).resolves.toEqual(cancelledResult);
    expect(events).toEqual([
      'idempotency.find',
      'transaction',
      'lock',
      'idempotency.find',
    ]);
    expect(orders.lookups).toEqual([]);
    expect(orders.updated).toEqual([]);
  });

  it('rejects a conflicting second read without searching for the order', async () => {
    const original = openLimit();
    const { events, idempotency, orders, useCase } = harness(original);
    idempotency.script(
      null,
      remembered({ outcome: 'NOT_FOUND' }, 'different-hash'),
    );

    await expect(useCase.execute(command(original.id))).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(events).toContain('transaction');
    expect(events).toContain('lock');
    expect(orders.lookups).toEqual([]);
    expect(idempotency.saved).toEqual([]);
  });

  it('hashes equivalent commands equally and different commands differently', () => {
    const original = openLimit();
    const base = command(original.id, 'first-key');
    const sameRequest = command(original.id, 'another-key');
    const otherOrder = command(identity(9, 1n).id);

    expect(cancelTradeOrderRequestHash(base)).toBe(
      cancelTradeOrderRequestHash(sameRequest),
    );
    expect(cancelTradeOrderRequestHash(base)).not.toBe(
      cancelTradeOrderRequestHash(otherOrder),
    );
    expect(cancelTradeOrderRequestHash(base)).not.toBe(
      cancelTradeOrderRequestHash(
        command(original.id, 'first-key', userId(fixtureUuid(8))),
      ),
    );
  });

  it('cancels a new limit order and persists the instance returned by cancel', async () => {
    const original = openLimit();
    const { accounts, events, idempotency, orders, useCase } =
      harness(original);
    const request = command(original.id);

    const result = await useCase.execute(request);

    expect(result).toEqual(cancelledResult);
    expect(result).not.toBeInstanceOf(TradeOrder);
    expect(original.status).toBe('NEW');
    expect(orders.found).toBe(original);
    expect(orders.updated).toHaveLength(1);
    expect(orders.updated[0]).not.toBe(original);
    expect(orders.updated[0]?.status).toBe('CANCELLED');
    expect(orders.updated[0]?.id).toBe(original.id);
    expect(orders.updated[0]?.price).toBe(original.price);
    expect(orders.updatedDuringTransaction).toBe(true);
    expect(orders.lookups).toEqual([
      { accountId: account, orderId: original.id },
    ]);
    expect(orders.updated[0]?.accountId).toBe(account);
    expect(result.outcome === 'CANCELLED' && result.order).not.toHaveProperty(
      'userId',
    );
    expect(idempotency.saved).toEqual([
      {
        userId: owner,
        idempotencyKey: 'client-key',
        operation: CANCEL_TRADE_ORDER,
        requestHash: cancelTradeOrderRequestHash(request),
        result: cancelTradeOrderResultToJson(cancelledResult),
      },
    ]);
    expect(idempotency.savedDuringTransaction).toBe(true);
    expect(
      cancelTradeOrderResultFromJson(cancelTradeOrderResultToJson(result)),
    ).toEqual(result);
    expect(events).toEqual([
      'idempotency.find',
      'transaction',
      'lock',
      'idempotency.find',
      'orders.findTradeForUpdate',
      'accounts.find',
      'orders.update',
      'accounts.save',
      'idempotency.save',
    ]);
    expect(accounts.state.reservedCash.isZero()).toBe(true);
    expect(accounts.committed).toHaveLength(1);
  });

  it('returns NOT_FOUND when the order does not exist and stores that result', async () => {
    const missing = identity(4, 1n).id;
    const { idempotency, orders, useCase } = harness(null);

    await expect(useCase.execute(command(missing))).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });
    expect(orders.updated).toEqual([]);
    expect(idempotency.saved[0]?.result).toEqual({ outcome: 'NOT_FOUND' });
    expect(idempotency.savedDuringTransaction).toBe(true);
  });

  it('returns NOT_FOUND when the order belongs to another account', async () => {
    const original = openLimit(accountId(fixtureUuid(90)));
    const { orders, useCase } = harness(original);

    await expect(useCase.execute(command(original.id))).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });
    expect(orders.lookups).toEqual([
      { accountId: account, orderId: original.id },
    ]);
    expect(orders.updated).toEqual([]);
    expect(original.status).toBe('NEW');
  });

  it('returns NOT_CANCELLABLE for a filled market order without updating it', async () => {
    const filled = TradeOrder.marketFilled({
      ...identity(4, 3n),
      side: 'BUY',
      price: price('10.50'),
    });
    const { idempotency, orders, useCase } = harness(filled);

    await expect(useCase.execute(command(filled.id))).resolves.toEqual({
      outcome: 'NOT_CANCELLABLE',
    });
    expect(filled.status).toBe('FILLED');
    expect(orders.updated).toEqual([]);
    expect(idempotency.saved[0]?.result).toEqual({
      outcome: 'NOT_CANCELLABLE',
    });
    expect(idempotency.savedDuringTransaction).toBe(true);
  });

  it('returns NOT_CANCELLABLE for a rejected or already cancelled order', async () => {
    const rejected = TradeOrder.limitRejected({
      ...identity(4, 3n),
      side: 'SELL',
      price: price('10.50'),
      reason: 'INSUFFICIENT_SHARES',
    });
    const cancelled = TradeOrder.limitCancelled({
      ...identity(4, 3n),
      side: 'BUY',
      price: price('10.50'),
    });

    const rejectedRun = harness(rejected);
    await expect(
      rejectedRun.useCase.execute(command(rejected.id)),
    ).resolves.toEqual({
      outcome: 'NOT_CANCELLABLE',
    });
    expect(rejectedRun.orders.updated).toEqual([]);
    expect(rejected.status).toBe('REJECTED');

    const cancelledRun = harness(cancelled);
    await expect(
      cancelledRun.useCase.execute(command(cancelled.id)),
    ).resolves.toEqual({ outcome: 'NOT_CANCELLABLE' });
    expect(cancelledRun.orders.updated).toEqual([]);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelledRun.idempotency.saved[0]?.result).toEqual({
      outcome: 'NOT_CANCELLABLE',
    });
  });

  it('returns NOT_FOUND when the repository hides a cash movement', async () => {
    const cashId = identity(12, 1n).id;
    const { orders, idempotency, useCase } = harness(null);

    await expect(useCase.execute(command(cashId))).resolves.toEqual({
      outcome: 'NOT_FOUND',
    });
    expect(orders.lookups).toEqual([{ accountId: account, orderId: cashId }]);
    expect(orders.updated).toEqual([]);
    expect(idempotency.saved[0]?.result).toEqual({ outcome: 'NOT_FOUND' });
  });

  it('propagates a missing account without consuming the idempotency key', async () => {
    const original = openLimit();
    const { events, accountLock, idempotency, orders, useCase } =
      harness(original);
    accountLock.missing = true;

    await expect(useCase.execute(command(original.id))).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
    expect(events).toEqual(['idempotency.find', 'transaction', 'lock']);
    expect(accountLock.acquiredDuringTransaction).toBe(true);
    expect(orders.lookups).toEqual([]);
    expect(orders.updated).toEqual([]);
    expect(idempotency.saved).toEqual([]);
    expect(original.status).toBe('NEW');
  });

  it('locks the account inside the transaction before the second idempotency check', async () => {
    const original = openLimit();
    const { events, accountLock, useCase } = harness(original);

    await useCase.execute(command(original.id));

    const firstFind = events.indexOf('idempotency.find');
    const transaction = events.indexOf('transaction');
    const lock = events.indexOf('lock');
    const secondFind = events.indexOf('idempotency.find', firstFind + 1);
    const lookup = events.indexOf('orders.findTradeForUpdate');
    const accountRead = events.indexOf('accounts.find');
    const update = events.indexOf('orders.update');
    const accountSave = events.indexOf('accounts.save');
    const save = events.indexOf('idempotency.save');

    expect(firstFind).toBeLessThan(transaction);
    expect(transaction).toBeLessThan(lock);
    expect(accountLock.acquiredDuringTransaction).toBe(true);
    expect(lock).toBeLessThan(secondFind);
    expect(secondFind).toBeLessThan(lookup);
    expect(lookup).toBeLessThan(accountRead);
    expect(accountRead).toBeLessThan(update);
    expect(update).toBeLessThan(accountSave);
    expect(accountSave).toBeLessThan(save);
  });

  it('propagates a lookup failure without storing idempotency or updating', async () => {
    const original = openLimit();
    const { idempotency, orders, useCase } = harness(original);
    orders.failOnFind = true;

    await expect(useCase.execute(command(original.id))).rejects.toThrow(
      'order lookup failed',
    );
    expect(orders.updated).toEqual([]);
    expect(idempotency.saved).toEqual([]);
    expect(original.status).toBe('NEW');
  });

  it('propagates an update failure without storing idempotency', async () => {
    const original = openLimit();
    const { idempotency, orders, useCase } = harness(original);
    orders.failOnUpdate = true;

    await expect(useCase.execute(command(original.id))).rejects.toThrow(
      'order update failed',
    );
    expect(orders.updated).toEqual([]);
    expect(idempotency.saved).toEqual([]);
    expect(original.status).toBe('NEW');
  });

  it('propagates an idempotency save failure after the cancelled order was staged', async () => {
    const original = openLimit();
    const { accounts, idempotency, orders, useCase } = harness(original);
    idempotency.failOnSave = true;

    await expect(useCase.execute(command(original.id))).rejects.toThrow(
      'idempotency insert failed',
    );
    expect(orders.updated).toHaveLength(1);
    expect(orders.updated[0]).not.toBe(original);
    expect(orders.updated[0]?.status).toBe('CANCELLED');
    expect(orders.committed).toHaveLength(0);
    expect(accounts.committed).toHaveLength(0);
    expect(original.status).toBe('NEW');
    expect(idempotency.saved).toEqual([]);
    expect(idempotency.committed).toHaveLength(0);
  });

  it('releases the cash reserved by a buy limit', async () => {
    const original = openLimit();
    const { accounts, useCase } = harness(original);

    await expect(useCase.execute(command(original.id))).resolves.toMatchObject({
      outcome: 'CANCELLED',
    });
    expect(accounts.state.reservedCash.isZero()).toBe(true);
  });

  it('releases the shares reserved by a sell limit', async () => {
    const original = TradeOrder.limitOpen({
      ...identity(4, 4n),
      side: 'SELL',
      price: price('12.50'),
    });
    const { accounts, useCase } = harness(original);

    await expect(useCase.execute(command(original.id))).resolves.toMatchObject({
      outcome: 'CANCELLED',
    });
    expect(accounts.state.reservedSharesOf(stock)).toBe(0n);
    expect(accounts.committed).toHaveLength(1);
  });

  it('does not release a reservation twice', async () => {
    const original = openLimit();
    const { accounts, useCase } = harness(original);

    await useCase.execute(command(original.id, 'first-key'));
    await expect(
      useCase.execute(command(original.id, 'second-key')),
    ).resolves.toEqual({ outcome: 'NOT_CANCELLABLE' });
    expect(accounts.committed).toHaveLength(1);
    expect(accounts.state.reservedCash.isZero()).toBe(true);
  });

  it('rolls back the cancellation when the reservation cannot be released', async () => {
    const original = openLimit();
    const missingReserve = harness(original, Account.open(account));

    await expect(
      missingReserve.useCase.execute(command(original.id)),
    ).rejects.toBeInstanceOf(ExcessReservationReleaseError);
    expect(missingReserve.orders.updated).toHaveLength(0);
    expect(missingReserve.orders.committed).toHaveLength(0);
    expect(missingReserve.idempotency.committed).toHaveLength(0);
    expect(original.status).toBe('NEW');

    const failedSave = harness(original);
    failedSave.accounts.failOnSave = true;
    await expect(
      failedSave.useCase.execute(command(original.id, 'save-fails')),
    ).rejects.toThrow('account save failed');
    expect(failedSave.orders.updated).toHaveLength(1);
    expect(failedSave.orders.committed).toHaveLength(0);
    expect(failedSave.accounts.committed).toHaveLength(0);
    expect(failedSave.idempotency.committed).toHaveLength(0);
    expect(original.status).toBe('NEW');
  });
});
