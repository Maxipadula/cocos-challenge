import { describe, expect, it } from 'vitest';

import {
  IdempotencyConflictError,
  IdempotencyStore,
  type NewIdempotencyRecord,
  type StoredIdempotency,
} from '#shared/application/idempotency-store.js';
import type { JsonValue } from '#shared/application/json.js';
import { UnitOfWork } from '#shared/application/unit-of-work.js';
import { UuidGenerator } from '#shared/application/uuid-generator.js';
import { Money } from '#shared/domain/value-objects/money.js';
import type { Uuid } from '#shared/domain/value-objects/uuid.js';

import {
  type InstrumentInfo,
  InstrumentQueries,
  type MarketDataQuote,
} from '#instruments/application/instrument-queries.js';
import { AccountNotFoundError } from '#orders/application/errors/account-not-found.error.js';
import { AccountLock } from '#orders/application/ports/account-lock.js';
import { AccountRepository } from '#orders/application/ports/account-repository.js';
import { OrderRepository } from '#orders/application/ports/order-repository.js';
import {
  InstrumentNotFoundError,
  InstrumentNotTradableError,
  InvalidIdempotencyResultError,
  MarketPriceUnavailableError,
  type SubmittedTradeOrder,
  submittedTradeOrderFromJson,
  submittedTradeOrderToJson,
  SubmitTradeOrder,
  type SubmitTradeOrderCommand,
  submitTradeOrderRequestHash,
} from '#orders/application/use-cases/submit-trade-order.js';
import { Account } from '#orders/domain/entities/account.js';
import { CashMovement } from '#orders/domain/entities/cash-movement.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import { OrderSizeRequiredError } from '#orders/domain/errors/order-errors.js';
import type { AccountEntry } from '#orders/domain/services/availability.js';
import type { AccountId } from '#orders/domain/value-objects/account-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';

import {
  account,
  fixtureUuid,
  identity,
  owner,
  peso,
  placedAt,
  price,
  stock,
} from '../../domain/order-fixture.js';

const generatedOrderId = fixtureUuid(50);

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
  readonly lookups: string[] = [];
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

  override async find(
    userId: Uuid,
    idempotencyKey: string,
  ): Promise<StoredIdempotency | null> {
    this.events.push('idempotency.find');
    this.lookups.push(`${userId}:${idempotencyKey}`);

    if (this.scripted.length > 0) {
      return this.scripted.shift() ?? null;
    }

    return (
      this.committed.find(
        (record) =>
          record.userId === userId && record.idempotencyKey === idempotencyKey,
      ) ?? null
    );
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
  readonly added: TradeOrder[] = [];
  readonly committed: TradeOrder[] = [];
  readonly queriedAccounts: AccountId[] = [];
  addedDuringTransaction = false;
  failOnAdd = false;
  private pending: TradeOrder[] = [];

  constructor(
    private readonly events: string[],
    private readonly unitOfWork: RecordingUnitOfWork,
    readonly entries: AccountEntry[] = [],
  ) {
    super();
  }

  override async findByAccount(
    accountId: AccountId,
  ): Promise<readonly AccountEntry[]> {
    this.events.push('orders.find');
    this.queriedAccounts.push(accountId);
    return this.entries;
  }

  override async add(order: TradeOrder): Promise<void> {
    this.events.push('orders.add');

    if (this.failOnAdd) {
      throw new Error('order insert failed');
    }

    this.addedDuringTransaction = this.unitOfWork.active;
    this.added.push(order);
    this.pending.push(order);
  }

  commit(): void {
    this.committed.push(...this.pending);
    this.pending = [];
  }

  rollback(): void {
    this.pending = [];
  }

  override async findTradeForUpdate(): Promise<TradeOrder | null> {
    throw new Error('SubmitTradeOrder does not lock an existing order.');
  }

  override async update(): Promise<void> {
    throw new Error('SubmitTradeOrder does not update an order.');
  }

  override async addCashMovement(): Promise<void> {
    throw new Error('SubmitTradeOrder does not insert a cash movement.');
  }
}

class MemoryInstruments extends InstrumentQueries {
  instrument: InstrumentInfo | null = {
    id: stock,
    ticker: 'GGAL',
    name: 'Grupo Financiero Galicia',
    type: 'ACCIONES',
  };
  close: string | null = '10.00';

  constructor(private readonly events: string[]) {
    super();
  }

  override async findById(): Promise<InstrumentInfo | null> {
    this.events.push('instrument');
    return this.instrument;
  }

  override async findByTicker(): Promise<InstrumentInfo | null> {
    return null;
  }

  override async search(): Promise<readonly InstrumentInfo[]> {
    return [];
  }

  override async findByIds(): Promise<readonly InstrumentInfo[]> {
    return [];
  }

  override async latestMarketDataFor(): Promise<readonly MarketDataQuote[]> {
    return [];
  }

  override async latestMarketData(
    id: InstrumentInfo['id'],
  ): Promise<MarketDataQuote | null> {
    this.events.push('close');

    if (!this.close) {
      return null;
    }

    return {
      instrumentId: id,
      close: this.close,
      previousClose: '0',
      observedAt: '2026-01-15T00:00:00.000Z',
    };
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
    private readonly unitOfWork: RecordingUnitOfWork,
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

function harness(
  entries: AccountEntry[] = [],
  reserved: Account = Account.open(account),
) {
  const events: string[] = [];
  const unitOfWork = new RecordingUnitOfWork(events);
  const idempotency = new MemoryIdempotencyStore(events, unitOfWork);
  const orders = new MemoryOrders(events, unitOfWork, entries);
  const accounts = new MemoryAccounts(events, unitOfWork, reserved);
  const instruments = new MemoryInstruments(events);
  const accountLock = new MemoryAccountLock(events, unitOfWork);
  unitOfWork.participants.push(idempotency, orders, accounts);
  const useCase = new SubmitTradeOrder(
    idempotency,
    instruments,
    unitOfWork,
    accountLock,
    orders,
    new FixedIds(events),
    accounts,
  );

  return {
    events,
    idempotency,
    orders,
    accounts,
    instruments,
    accountLock,
    useCase,
  };
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

function sellCommand(
  type: 'MARKET' | 'LIMIT',
  quantity: bigint,
): SubmitTradeOrderCommand {
  const base = {
    userId: owner,
    instrumentId: stock,
    side: 'SELL' as const,
    idempotencyKey: `sell-${type}-${quantity}`,
    sizing: {
      kind: 'QUANTITY' as const,
      quantity: ShareQuantity.of(quantity),
    },
  };

  return type === 'MARKET'
    ? { ...base, type: 'MARKET' }
    : { ...base, type: 'LIMIT', limitPrice: price('12.50') };
}

function holding(quantity: bigint): TradeOrder {
  return TradeOrder.marketFilled({
    ...identity(2, quantity),
    side: 'BUY',
    price: price('10.00'),
  });
}

function storedResult(
  command: SubmitTradeOrderCommand,
  overrides: Partial<SubmittedTradeOrder> = {},
): StoredIdempotency {
  const result: SubmittedTradeOrder = {
    id: fixtureUuid(9),
    accountId: account,
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
    expect(result.accountId).toBe(account);
    expect(events).toEqual(['idempotency.find']);
    expect(events).not.toContain('lock');
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
    instruments.instrument = {
      id: stock,
      ticker: 'ARS',
      name: 'Peso argentino',
      type: 'MONEDA',
    };

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
    const { orders, accounts, idempotency, useCase } = harness([
      deposit('1000.00'),
    ]);

    const result = await useCase.execute(marketCommand());

    expect(result).toMatchObject({
      id: generatedOrderId,
      accountId: account,
      status: 'FILLED',
      size: '2',
      price: '10',
      rejectionReason: null,
    });
    expect(result).not.toHaveProperty('userId');
    expect(orders.queriedAccounts).toEqual([account]);
    expect(orders.added[0]?.accountId).toBe(account);
    expect(orders.added[0]?.status).toBe('FILLED');
    expect(orders.added[0]?.settledCashDelta().toDecimalString()).toBe(
      '-20.00',
    );
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedCash.isZero()).toBe(true);
    expect(idempotency.saved[0]?.result).toEqual(
      submittedTradeOrderToJson(result),
    );
    expect(idempotency.saved[0]?.result).toMatchObject({ accountId: account });
    expect(idempotency.saved[0]?.userId).toBe(owner);
  });

  it('opens an accepted limit buy and persists the exact cash reserve', async () => {
    const { orders, accounts, events, useCase } = harness([deposit('1000.00')]);

    const result = await useCase.execute(
      limitCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(3n) }),
    );

    expect(result.status).toBe('NEW');
    expect(result.size).toBe('3');
    expect(result.price).toBe('33.33');
    expect(
      orders.added[0]?.price.multiply(orders.added[0].size).toDecimalString(),
    ).toBe('99.99');
    expect(accounts.committed).toHaveLength(1);
    expect(accounts.state.reservedCash.toDecimalString()).toBe('99.99');
    expect(events.indexOf('accounts.save')).toBeGreaterThan(
      events.indexOf('orders.add'),
    );
    expect(events.indexOf('idempotency.save')).toBeGreaterThan(
      events.indexOf('accounts.save'),
    );
  });

  it('persists a rejected order and its idempotent result without moving cash', async () => {
    const funded = deposit('10.00');
    const { orders, accounts, idempotency, useCase } = harness([funded]);

    const result = await useCase.execute(marketCommand());

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(orders.added).toHaveLength(1);
    expect(orders.added[0]?.settledCashDelta().isZero()).toBe(true);
    expect(idempotency.saved).toHaveLength(1);
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedCash.isZero()).toBe(true);
  });

  it('converts the close string from instruments into the order unit price', async () => {
    const { instruments, useCase } = harness([deposit('100.00')]);
    instruments.close = '33.3300';

    const result = await useCase.execute(
      marketCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(1n) }),
    );

    expect(result.status).toBe('FILLED');
    expect(result.price).toBe('33.33');
    expect(result.size).toBe('1');
  });

  it('derives the share quantity from the amount using the close', async () => {
    const { instruments, orders, useCase } = harness([deposit('100.00')]);
    instruments.close = '33.33';

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
    expect(events).toContain('lock');
    expect(events).not.toContain('orders.find');
    expect(events).not.toContain('accounts.find');
    expect(events).not.toContain('accounts.save');
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

  it('locks the account inside the transaction and before the second idempotency lookup', async () => {
    const { events, accountLock, useCase } = harness([deposit('1000.00')]);

    await useCase.execute(marketCommand());

    const reads = events
      .map((event, index) => (event === 'idempotency.find' ? index : -1))
      .filter((index) => index >= 0);
    const lock = events.indexOf('lock');

    expect(reads).toHaveLength(2);
    expect(lock).toBeGreaterThan(events.indexOf('transaction'));
    expect(lock).toBeGreaterThan(reads[0] as number);
    expect(lock).toBeLessThan(reads[1] as number);
    expect(accountLock.acquiredDuringTransaction).toBe(true);
  });

  it('reads the account orders after the lock and inside the transaction', async () => {
    const { events, orders, useCase } = harness([deposit('1000.00')]);

    await useCase.execute(marketCommand());

    expect(orders.queriedAccounts).toEqual([account]);
    expect(events.indexOf('accounts.find')).toBeGreaterThan(
      events.lastIndexOf('idempotency.find'),
    );
    expect(events.indexOf('orders.find')).toBeGreaterThan(
      events.indexOf('accounts.find'),
    );
    expect(orders.addedDuringTransaction).toBe(true);
  });

  it('propagates a missing account without consuming the idempotency key', async () => {
    const { events, accountLock, idempotency, orders, useCase } = harness([
      deposit('1000.00'),
    ]);
    accountLock.missing = true;

    await expect(useCase.execute(marketCommand())).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
    expect(events).toContain('idempotency.find');
    expect(events).toContain('transaction');
    expect(events).toContain('lock');
    expect(accountLock.acquiredDuringTransaction).toBe(true);
    expect(orders.queriedAccounts).toEqual([]);
    expect(orders.added).toEqual([]);
    expect(idempotency.saved).toEqual([]);
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
    expect(orders.committed).toHaveLength(0);
    expect(idempotency.saved).toHaveLength(0);
    expect(idempotency.committed).toHaveLength(0);
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

  it('rejects a market buy that would spend a preexisting cash reserve', async () => {
    const reserved = Account.open(account).reserveCash(Money.parse('6000'));
    const { accounts, useCase } = harness([deposit('10000')], reserved);

    const rejected = await useCase.execute(
      marketCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(500n) }),
    );

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedCash.toDecimalString()).toBe('6000');
  });

  it('fills a market buy that fits beside a preexisting cash reserve', async () => {
    const reserved = Account.open(account).reserveCash(Money.parse('6000'));
    const { accounts, orders, useCase } = harness([deposit('10000')], reserved);

    const filled = await useCase.execute(
      marketCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(400n) }),
    );

    expect(filled.status).toBe('FILLED');
    expect(orders.added[0]?.settledCashDelta().toDecimalString()).toBe(
      '-4000.00',
    );
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedCash.toDecimalString()).toBe('6000');
  });

  it('rejects a limit buy without creating a reserve', async () => {
    const { accounts, orders, useCase } = harness([deposit('10.00')]);

    const result = await useCase.execute(
      limitCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(2n) }),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(orders.committed).toHaveLength(1);
    expect(accounts.saved).toHaveLength(0);
  });

  it('reserves the floored limit cost and leaves the remainder available', async () => {
    const { accounts, useCase } = harness([deposit('100.00')]);

    const result = await useCase.execute(
      limitCommand({ kind: 'AMOUNT', amount: Money.parse('100.00') }),
    );

    expect(result.status).toBe('NEW');
    expect(result.size).toBe('3');
    expect(accounts.state.reservedCash.toDecimalString()).toBe('99.99');
    expect(
      accounts.state.availableCash(Money.parse('100.00')).toDecimalString(),
    ).toBe('0.01');
  });

  it('rejects a market sell that would use reserved shares', async () => {
    const reserved = Account.open(account).reserveShares(
      stock,
      ShareQuantity.of(6n),
    );
    const { accounts, useCase } = harness([holding(10n)], reserved);

    const result = await useCase.execute(sellCommand('MARKET', 5n));

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toBe('INSUFFICIENT_SHARES');
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedSharesOf(stock)).toBe(6n);
  });

  it('reserves shares for an accepted limit sell and rejects the excess', async () => {
    const { accounts, useCase } = harness([holding(10n)]);

    const accepted = await useCase.execute(sellCommand('LIMIT', 6n));
    const rejected = await useCase.execute(sellCommand('LIMIT', 5n));

    expect(accepted.status).toBe('NEW');
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('INSUFFICIENT_SHARES');
    expect(accounts.committed).toHaveLength(1);
    expect(accounts.state.reservedSharesOf(stock)).toBe(6n);
  });

  it('accumulates share reserves for the same instrument', async () => {
    const { accounts, useCase } = harness([holding(10n)]);

    await useCase.execute(sellCommand('LIMIT', 3n));
    await useCase.execute(sellCommand('LIMIT', 2n));

    expect(accounts.state.reservedSharesOf(stock)).toBe(5n);
    expect(accounts.state.availableShares(stock, 10n)).toBe(5n);
  });

  it('replays an accepted limit without reserving twice', async () => {
    const { accounts, orders, useCase } = harness([deposit('1000.00')]);
    const command = limitCommand({
      kind: 'QUANTITY',
      quantity: ShareQuantity.of(3n),
    });

    await useCase.execute(command);
    await useCase.execute(command);

    expect(orders.committed).toHaveLength(1);
    expect(accounts.committed).toHaveLength(1);
    expect(accounts.state.reservedCash.toDecimalString()).toBe('99.99');
  });

  it('rolls back the order, the reserve, and idempotency together', async () => {
    const failedReserve = harness([deposit('1000.00')]);
    failedReserve.accounts.failOnSave = true;

    await expect(
      failedReserve.useCase.execute(
        limitCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(3n) }),
      ),
    ).rejects.toThrow('account save failed');
    expect(failedReserve.orders.added).toHaveLength(1);
    expect(failedReserve.orders.committed).toHaveLength(0);
    expect(failedReserve.accounts.committed).toHaveLength(0);
    expect(failedReserve.idempotency.committed).toHaveLength(0);

    const failedIdempotency = harness([deposit('1000.00')]);
    failedIdempotency.idempotency.failOnSave = true;

    await expect(
      failedIdempotency.useCase.execute(
        limitCommand({ kind: 'QUANTITY', quantity: ShareQuantity.of(3n) }),
      ),
    ).rejects.toThrow('idempotency insert failed');
    expect(failedIdempotency.orders.committed).toHaveLength(0);
    expect(failedIdempotency.accounts.saved).toHaveLength(1);
    expect(failedIdempotency.accounts.committed).toHaveLength(0);
    expect(failedIdempotency.idempotency.committed).toHaveLength(0);
    expect(failedIdempotency.accounts.state.reservedCash.isZero()).toBe(true);
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
