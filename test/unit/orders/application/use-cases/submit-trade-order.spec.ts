import { describe, expect, it } from 'vitest';
import { InstrumentQueries } from '../../../../../src/instruments/application/instrument-queries.js';
import type { InstrumentInfo } from '../../../../../src/instruments/application/instrument-queries.js';
import { CashMovement } from '../../../../../src/orders/domain/entities/cash-movement.js';
import type { TradeOrder } from '../../../../../src/orders/domain/entities/trade-order.js';
import { OrderSizeRequiredError } from '../../../../../src/orders/domain/errors/order-errors.js';
import { availableCash } from '../../../../../src/orders/domain/services/availability.js';
import type { AccountEntry } from '../../../../../src/orders/domain/services/availability.js';
import { OrderRepository } from '../../../../../src/orders/application/ports/order-repository.js';
import { UserLock } from '../../../../../src/orders/application/ports/user-lock.js';
import {
  InstrumentNotFoundError,
  InstrumentNotTradableError,
  InvalidIdempotencyResultError,
  MarketPriceUnavailableError,
  SubmitTradeOrder,
  submittedTradeOrderFromJson,
  submittedTradeOrderToJson,
  submitTradeOrderRequestHash,
  type SubmitTradeOrderCommand,
  type SubmittedTradeOrder,
} from '../../../../../src/orders/application/use-cases/submit-trade-order.js';
import {
  IdempotencyConflictError,
  IdempotencyStore,
} from '../../../../../src/shared/application/idempotency-store.js';
import type {
  NewIdempotencyRecord,
  StoredIdempotency,
} from '../../../../../src/shared/application/idempotency-store.js';
import type { JsonValue } from '../../../../../src/shared/application/json.js';
import { UnitOfWork } from '../../../../../src/shared/application/unit-of-work.js';
import { UuidGenerator } from '../../../../../src/shared/application/uuid-generator.js';
import { Money } from '../../../../../src/shared/domain/value-objects/money.js';
import { ShareQuantity } from '../../../../../src/shared/domain/value-objects/share-quantity.js';
import type { UnitPrice } from '../../../../../src/shared/domain/value-objects/unit-price.js';
import type { UserId } from '../../../../../src/shared/domain/value-objects/ids.js';
import {
  fixtureUuid,
  identity,
  owner,
  peso,
  placedAt,
  price,
  stock,
} from '../../domain/order-fixture.js';

const generatedOrderId = fixtureUuid(50);

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
  readonly lookups: string[] = [];
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

  override async find(
    userId: UserId,
    idempotencyKey: string,
  ): Promise<StoredIdempotency | null> {
    this.events.push('idempotency.find');
    this.lookups.push(`${userId}:${idempotencyKey}`);
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
  readonly added: TradeOrder[] = [];
  addedDuringTransaction = false;
  failOnAdd = false;

  constructor(
    private readonly events: string[],
    private readonly unitOfWork: RecordingUnitOfWork,
    readonly entries: AccountEntry[] = [],
  ) {
    super();
  }

  override async findByUser(): Promise<readonly AccountEntry[]> {
    this.events.push('orders.find');
    return this.entries;
  }

  override async add(order: TradeOrder): Promise<void> {
    this.events.push('orders.add');

    if (this.failOnAdd) {
      throw new Error('order insert failed');
    }

    this.addedDuringTransaction = this.unitOfWork.active;
    this.added.push(order);
  }
}

class MemoryInstruments extends InstrumentQueries {
  instrument: InstrumentInfo | null = { id: stock, type: 'ACCIONES' };
  close: UnitPrice | null = price('10.00');

  constructor(private readonly events: string[]) {
    super();
  }

  override async findById(): Promise<InstrumentInfo | null> {
    this.events.push('instrument');
    return this.instrument;
  }

  override async latestClose(): Promise<UnitPrice | null> {
    this.events.push('close');
    return this.close;
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

class FixedIds extends UuidGenerator {
  constructor(private readonly events: string[]) {
    super();
  }

  override generate(): string {
    this.events.push('id');
    return generatedOrderId;
  }
}

function deposit(amount: string): CashMovement {
  return CashMovement.cashIn({
    ...identity(1, 1n),
    instrumentId: peso,
    amount: Money.parse(amount),
  });
}

function harness(entries: AccountEntry[] = []) {
  const events: string[] = [];
  const unitOfWork = new RecordingUnitOfWork(events);
  const idempotency = new MemoryIdempotencyStore(events, unitOfWork);
  const orders = new MemoryOrders(events, unitOfWork, entries);
  const instruments = new MemoryInstruments(events);
  const useCase = new SubmitTradeOrder(
    idempotency,
    instruments,
    unitOfWork,
    new MemoryUserLock(events),
    orders,
    new FixedIds(events),
  );

  return { events, idempotency, orders, instruments, useCase };
}

function marketCommand(
  sizing: SubmitTradeOrderCommand['sizing'] = {
    kind: 'QUANTITY',
    quantity: ShareQuantity.of(2n),
  },
): SubmitTradeOrderCommand {
  return {
    userId: owner,
    instrumentId: stock,
    side: 'BUY',
    type: 'MARKET',
    idempotencyKey: 'client-key',
    sizing,
  };
}

function limitCommand(
  sizing: SubmitTradeOrderCommand['sizing'] = {
    kind: 'QUANTITY',
    quantity: ShareQuantity.of(2n),
  },
): SubmitTradeOrderCommand {
  return {
    userId: owner,
    instrumentId: stock,
    side: 'BUY',
    type: 'LIMIT',
    limitPrice: price('33.33'),
    idempotencyKey: 'client-key',
    sizing,
  };
}

function storedResult(
  command: SubmitTradeOrderCommand,
  overrides: Partial<SubmittedTradeOrder> = {},
): StoredIdempotency {
  const result: SubmittedTradeOrder = {
    id: fixtureUuid(9),
    userId: owner,
    instrumentId: stock,
    side: 'BUY',
    type: command.type,
    status: 'FILLED',
    size: '2',
    price: '10',
    rejectionReason: null,
    placedAt: placedAt.toISOString(),
    ...overrides,
  };

  return {
    operation: 'orders.submit-trade',
    requestHash: submitTradeOrderRequestHash(command),
    result: submittedTradeOrderToJson(result),
  };
}

describe('SubmitTradeOrder', () => {
  it('replays a stored result before querying instruments or market data', async () => {
    const command = marketCommand();
    const { events, instruments, useCase, idempotency } = harness();
    const stored = storedResult(command);
    idempotency.script(stored);

    const result = await useCase.execute(command);

    expect(result).toEqual(submittedTradeOrderFromJson(stored.result));
    expect(events).toEqual(['idempotency.find']);
    expect(instruments.instrument).not.toBeNull();
  });

  it('conflicts on the first read when the stored hash differs', async () => {
    const command = marketCommand();
    const { events, useCase, idempotency, orders } = harness();
    idempotency.script({
      ...storedResult(command),
      requestHash: 'different-hash',
    });

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(events).toEqual(['idempotency.find']);
    expect(orders.added).toHaveLength(0);
  });

  it('rejects a missing instrument without opening a transaction', async () => {
    const { events, instruments, idempotency, useCase } = harness();
    instruments.instrument = null;

    await expect(useCase.execute(marketCommand())).rejects.toBeInstanceOf(
      InstrumentNotFoundError,
    );
    expect(events).toEqual(['idempotency.find', 'instrument']);
    expect(idempotency.saved).toHaveLength(0);
  });

  it('rejects a currency instrument without reading market data', async () => {
    const { events, instruments, idempotency, useCase } = harness();
    instruments.instrument = { id: stock, type: 'MONEDA' };

    await expect(useCase.execute(marketCommand())).rejects.toBeInstanceOf(
      InstrumentNotTradableError,
    );
    expect(events).toEqual(['idempotency.find', 'instrument']);
    expect(idempotency.saved).toHaveLength(0);
  });

  it('rejects a market order when the latest close is missing', async () => {
    const { events, instruments, idempotency, orders, useCase } = harness();
    instruments.close = null;

    await expect(useCase.execute(marketCommand())).rejects.toBeInstanceOf(
      MarketPriceUnavailableError,
    );
    expect(events).toEqual(['idempotency.find', 'instrument', 'close']);
    expect(orders.added).toHaveLength(0);
    expect(idempotency.saved).toHaveLength(0);
  });

  it('does not read market data for a limit order', async () => {
    const { events, useCase } = harness([deposit('1000.00')]);

    const result = await useCase.execute(limitCommand());

    expect(result.status).toBe('NEW');
    expect(events).not.toContain('close');
  });

  it('fills an accepted market buy at the close and keeps the execution price', async () => {
    const { orders, idempotency, useCase } = harness([deposit('1000.00')]);

    const result = await useCase.execute(marketCommand());

    expect(result).toMatchObject({
      id: generatedOrderId,
      status: 'FILLED',
      size: '2',
      price: '10',
      rejectionReason: null,
    });
    expect(orders.added[0]?.status).toBe('FILLED');
    expect(orders.added[0]?.settledCashDelta().toDecimalString()).toBe(
      '-20.00',
    );
    expect(idempotency.saved[0]?.result).toEqual(
      submittedTradeOrderToJson(result),
    );
  });

  it('opens an accepted limit buy and commits size times the limit price', async () => {
    const { orders, useCase } = harness([deposit('1000.00')]);

    const result = await useCase.execute(
      limitCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(3n) }),
    );

    expect(result.status).toBe('NEW');
    expect(result.size).toBe('3');
    expect(result.price).toBe('33.33');
    expect(orders.added[0]?.committedCash().toDecimalString()).toBe('99.99');
  });

  it('persists a rejected order and its idempotent result without moving cash', async () => {
    const funded = deposit('10.00');
    const { orders, idempotency, useCase } = harness([funded]);

    const result = await useCase.execute(marketCommand());

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(orders.added).toHaveLength(1);
    expect(idempotency.saved).toHaveLength(1);
    expect(
      availableCash([funded, orders.added[0] as TradeOrder]).toDecimalString(),
    ).toBe('10.00');
  });

  it('derives the share quantity from the amount using the close', async () => {
    const { instruments, orders, useCase } = harness([deposit('100.00')]);
    instruments.close = price('33.33');

    const result = await useCase.execute(
      marketCommand({ kind: 'AMOUNT', amount: Money.parse('100.00') }),
    );

    expect(result.status).toBe('FILLED');
    expect(result.size).toBe('3');
    expect(orders.added[0]?.settledCashDelta().toDecimalString()).toBe(
      '-99.99',
    );
  });

  it('replays the second idempotency read without deciding again', async () => {
    const command = marketCommand();
    const { events, idempotency, useCase } = harness([deposit('1000.00')]);
    const stored = storedResult(command);
    idempotency.script(null, stored);

    const result = await useCase.execute(command);

    expect(result).toEqual(submittedTradeOrderFromJson(stored.result));
    expect(events).toContain('instrument');
    expect(events).toContain('close');
    expect(events).not.toContain('orders.find');
    expect(events).not.toContain('orders.add');
    expect(events).not.toContain('id');
  });

  it('conflicts on the second idempotency read after the external lookups', async () => {
    const command = marketCommand();
    const { events, idempotency, useCase } = harness();
    idempotency.script(null, {
      ...storedResult(command),
      requestHash: 'other-hash',
    });

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(events).toContain('instrument');
    expect(events).not.toContain('orders.add');
    expect(idempotency.saved).toHaveLength(0);
  });

  it('locks the user before the second idempotency lookup', async () => {
    const { events, useCase } = harness([deposit('1000.00')]);

    await useCase.execute(marketCommand());

    const reads = events
      .map((event, index) => (event === 'idempotency.find' ? index : -1))
      .filter((index) => index >= 0);
    const lock = events.indexOf('lock');

    expect(reads).toHaveLength(2);
    expect(lock).toBeGreaterThan(reads[0] as number);
    expect(lock).toBeLessThan(reads[1] as number);
  });

  it('reads the user orders after the lock and inside the transaction', async () => {
    const { events, orders, useCase } = harness([deposit('1000.00')]);

    await useCase.execute(marketCommand());

    expect(events.indexOf('orders.find')).toBeGreaterThan(
      events.indexOf('lock'),
    );
    expect(orders.addedDuringTransaction).toBe(true);
  });

  it('saves the order and the idempotent result in the same transaction', async () => {
    const { idempotency, orders, useCase } = harness([deposit('1000.00')]);

    const result = await useCase.execute(marketCommand());

    expect(orders.addedDuringTransaction).toBe(true);
    expect(idempotency.savedDuringTransaction).toBe(true);
    expect(idempotency.saved[0]?.requestHash).toBe(
      submitTradeOrderRequestHash(marketCommand()),
    );
    expect(
      submittedTradeOrderFromJson(idempotency.saved[0]?.result as JsonValue),
    ).toEqual(result);
  });

  it('propagates an insert failure and does not store idempotency', async () => {
    const { orders, idempotency, useCase } = harness([deposit('1000.00')]);
    orders.failOnAdd = true;

    await expect(useCase.execute(marketCommand())).rejects.toThrow(
      'order insert failed',
    );
    expect(idempotency.saved).toHaveLength(0);
  });

  it('propagates an idempotency save failure after the order insert', async () => {
    const { orders, idempotency, useCase } = harness([deposit('1000.00')]);
    idempotency.failOnSave = true;

    await expect(useCase.execute(marketCommand())).rejects.toThrow(
      'idempotency insert failed',
    );
    expect(orders.added).toHaveLength(1);
    expect(idempotency.saved).toHaveLength(0);
  });

  it('does not turn a technical failure into a business result', async () => {
    const { useCase, orders } = harness([deposit('1000.00')]);
    orders.failOnAdd = true;

    await expect(useCase.execute(marketCommand())).rejects.toThrow(Error);
    await expect(useCase.execute(marketCommand())).rejects.not.toBeInstanceOf(
      InstrumentNotFoundError,
    );
  });

  it('does not consume the idempotency key when validation fails before writing', async () => {
    const missing = harness();
    missing.instruments.instrument = null;
    await expect(
      missing.useCase.execute(marketCommand()),
    ).rejects.toBeInstanceOf(InstrumentNotFoundError);
    expect(missing.idempotency.saved).toHaveLength(0);

    const tooSmall = harness([deposit('100.00')]);
    await expect(
      tooSmall.useCase.execute(
        marketCommand({ kind: 'AMOUNT', amount: Money.parse('0.01') }),
      ),
    ).rejects.toBeInstanceOf(OrderSizeRequiredError);
    expect(tooSmall.orders.added).toHaveLength(0);
    expect(tooSmall.idempotency.saved).toHaveLength(0);
  });

  it('rejects a stored payload that is not a trade order result', async () => {
    const command = marketCommand();
    const { idempotency, useCase } = harness();
    idempotency.script({
      operation: 'orders.submit-trade',
      requestHash: submitTradeOrderRequestHash(command),
      result: { status: 'FILLED' },
    });

    await expect(useCase.execute(command)).rejects.toBeInstanceOf(
      InvalidIdempotencyResultError,
    );
  });
});
