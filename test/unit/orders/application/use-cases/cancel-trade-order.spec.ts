import { describe, expect, it } from 'vitest';

import {
  IdempotencyConflictError,
  IdempotencyStore,
  type NewIdempotencyRecord,
  type StoredIdempotency,
} from '#shared/application/idempotency-store.js';
import { UnitOfWork } from '#shared/application/unit-of-work.js';

import { OrderRepository } from '#orders/application/ports/order-repository.js';
import { UserLock } from '#orders/application/ports/user-lock.js';
import {
  CANCEL_TRADE_ORDER,
  CancelTradeOrder,
  type CancelTradeOrderCommand,
  cancelTradeOrderRequestHash,
  type CancelTradeOrderResult,
  cancelTradeOrderResultFromJson,
  cancelTradeOrderResultToJson,
} from '#orders/application/use-cases/cancel-trade-order.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import type { OrderId } from '#orders/domain/value-objects/order-id.js';
import { type UserId, userId } from '#orders/domain/value-objects/user-id.js';

import {
  fixtureUuid,
  identity,
  owner,
  placedAt,
  price,
  stock,
} from '../../domain/order-fixture.js';

class RecordingUnitOfWork extends UnitOfWork {
  constructor(private readonly events: string[]) {
    super();
  }

  active = false;

  override async run<T>(work: () => Promise<T>): Promise<T> {
    this.events.push('transaction');
    this.active = true;

    try {
      return await work();
    } finally {
      this.active = false;
    }
  }
}

class MemoryIdempotencyStore extends IdempotencyStore {
  readonly saved: NewIdempotencyRecord[] = [];
  savedDuringTransaction = false;
  failOnSave = false;
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
  }
}

class MemoryOrders extends OrderRepository {
  readonly updated: TradeOrder[] = [];
  readonly lookups: Array<{ userId: UserId; orderId: OrderId }> = [];
  updatedDuringTransaction = false;
  found: TradeOrder | null = null;
  failOnFind = false;
  failOnUpdate = false;

  constructor(
    private readonly events: string[],
    private readonly unitOfWork: RecordingUnitOfWork,
    private trade: TradeOrder | null,
  ) {
    super();
  }

  override async findByUser(): Promise<readonly []> {
    return [];
  }

  override async add(): Promise<void> {
    throw new Error('CancelTradeOrder does not insert an order.');
  }

  override async findTradeForUpdate(
    userId: UserId,
    orderId: OrderId,
  ): Promise<TradeOrder | null> {
    this.events.push('orders.findTradeForUpdate');
    this.lookups.push({ userId, orderId });

    if (this.failOnFind) {
      throw new Error('order lookup failed');
    }

    if (
      !this.trade ||
      this.trade.userId !== userId ||
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
  }
}

class MemoryUserLock extends UserLock {
  constructor(private readonly events: string[]) {
    super();
  }

  override async acquire(): Promise<void> {
    this.events.push('lock');
  }
}

function openLimit(): TradeOrder {
  return TradeOrder.limitOpen({
    ...identity(4, 3n),
    side: 'BUY',
    price: price('10.50'),
  });
}

function harness(trade: TradeOrder | null = openLimit()) {
  const events: string[] = [];
  const unitOfWork = new RecordingUnitOfWork(events);
  const idempotency = new MemoryIdempotencyStore(events, unitOfWork);
  const orders = new MemoryOrders(events, unitOfWork, trade);
  const useCase = new CancelTradeOrder(
    idempotency,
    unitOfWork,
    new MemoryUserLock(events),
    orders,
  );

  return { events, idempotency, orders, useCase };
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
    userId: owner,
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
    const { events, idempotency, orders, useCase } = harness(original);
    const request = command(original.id);
    idempotency.script(
      remembered(cancelledResult, cancelTradeOrderRequestHash(request)),
    );

    await expect(useCase.execute(request)).resolves.toEqual(cancelledResult);
    expect(events).toEqual(['idempotency.find']);
    expect(events).not.toContain('transaction');
    expect(orders.lookups).toEqual([]);
    expect(orders.updated).toEqual([]);
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
    const { events, idempotency, orders, useCase } = harness(original);
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
    expect(orders.lookups).toEqual([{ userId: owner, orderId: original.id }]);
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
      'orders.update',
      'idempotency.save',
    ]);
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

  it('returns NOT_FOUND when the order belongs to another user', async () => {
    const original = openLimit();
    const { orders, useCase } = harness(original);
    const someoneElse = userId(fixtureUuid(8));

    await expect(
      useCase.execute(command(original.id, 'client-key', someoneElse)),
    ).resolves.toEqual({ outcome: 'NOT_FOUND' });
    expect(orders.lookups).toEqual([
      { userId: someoneElse, orderId: original.id },
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
    expect(orders.lookups).toEqual([{ userId: owner, orderId: cashId }]);
    expect(orders.updated).toEqual([]);
    expect(idempotency.saved[0]?.result).toEqual({ outcome: 'NOT_FOUND' });
  });

  it('locks the user before the second idempotency check and searches after both reads', async () => {
    const original = openLimit();
    const { events, useCase } = harness(original);

    await useCase.execute(command(original.id));

    const firstFind = events.indexOf('idempotency.find');
    const transaction = events.indexOf('transaction');
    const lock = events.indexOf('lock');
    const secondFind = events.indexOf('idempotency.find', firstFind + 1);
    const lookup = events.indexOf('orders.findTradeForUpdate');
    const update = events.indexOf('orders.update');
    const save = events.indexOf('idempotency.save');

    expect(firstFind).toBeLessThan(transaction);
    expect(transaction).toBeLessThan(lock);
    expect(lock).toBeLessThan(secondFind);
    expect(secondFind).toBeLessThan(lookup);
    expect(lookup).toBeLessThan(update);
    expect(update).toBeLessThan(save);
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
    const { idempotency, orders, useCase } = harness(original);
    idempotency.failOnSave = true;

    await expect(useCase.execute(command(original.id))).rejects.toThrow(
      'idempotency insert failed',
    );
    expect(orders.updated).toHaveLength(1);
    expect(orders.updated[0]).not.toBe(original);
    expect(orders.updated[0]?.status).toBe('CANCELLED');
    expect(original.status).toBe('NEW');
    expect(idempotency.saved).toEqual([]);
  });
});
