import { describe, expect, it } from 'vitest';

import {
  IdempotencyConflictError,
  IdempotencyStore,
  type NewIdempotencyRecord,
  type StoredIdempotency,
} from '#shared/application/idempotency-store.js';
import { UnitOfWork } from '#shared/application/unit-of-work.js';
import { UuidGenerator } from '#shared/application/uuid-generator.js';
import { InvalidMoneyError } from '#shared/domain/errors/value-object-errors.js';
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
  CashCurrencyUnavailableError,
  SubmitCashMovement,
  type SubmitCashMovementCommand,
  submitCashMovementRequestHash,
} from '#orders/application/use-cases/submit-cash-movement.js';
import { Account } from '#orders/domain/entities/account.js';
import { CashMovement } from '#orders/domain/entities/cash-movement.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import { NonPositiveAmountError } from '#orders/domain/errors/order-errors.js';
import type { AccountEntry } from '#orders/domain/services/availability.js';
import type { AccountId } from '#orders/domain/value-objects/account-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';

import {
  account,
  fixtureUuid,
  identity,
  owner,
  peso,
  price,
  stock,
} from '../../domain/order-fixture.js';

const generatedOrderId = fixtureUuid(60);

type TransactionParticipant = {
  commit(): void;
  rollback(): void;
};

class RecordingUnitOfWork extends UnitOfWork {
  readonly participants: TransactionParticipant[] = [];
  active = false;

  constructor(private readonly events: string[]) {
    super();
  }

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
  failOnSave = false;
  private pending: NewIdempotencyRecord[] = [];
  private readonly scripted: Array<StoredIdempotency | null> = [];

  constructor(private readonly events: string[]) {
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
  readonly added: CashMovement[] = [];
  readonly committed: CashMovement[] = [];
  failOnAdd = false;
  private pending: CashMovement[] = [];

  constructor(
    private readonly events: string[],
    readonly entries: AccountEntry[] = [],
  ) {
    super();
  }

  override async findByAccount(): Promise<readonly AccountEntry[]> {
    this.events.push('orders.find');
    return this.entries;
  }

  override async add(): Promise<void> {
    throw new Error('SubmitCashMovement does not insert a trade.');
  }

  override async addCashMovement(movement: CashMovement): Promise<void> {
    this.events.push('orders.addCash');

    if (this.failOnAdd) {
      throw new Error('cash insert failed');
    }

    this.added.push(movement);
    this.pending.push(movement);
  }

  override async findTradeForUpdate(): Promise<null> {
    throw new Error('SubmitCashMovement does not lock a trade.');
  }

  override async update(): Promise<void> {
    throw new Error('SubmitCashMovement does not update an order.');
  }

  commit(): void {
    this.committed.push(...this.pending);
    this.pending = [];
  }

  rollback(): void {
    this.pending = [];
  }
}

class MemoryAccounts extends AccountRepository {
  readonly saved: Account[] = [];

  constructor(
    private readonly events: string[],
    readonly state: Account,
  ) {
    super();
  }

  override async findById(id: AccountId): Promise<Account | null> {
    this.events.push('accounts.find');
    return id === this.state.id ? this.state : null;
  }

  override async save(next: Account): Promise<void> {
    this.events.push('accounts.save');
    this.saved.push(next);
  }
}

class MemoryInstruments extends InstrumentQueries {
  currency: InstrumentInfo | null = {
    id: peso,
    ticker: 'ARS',
    name: 'Peso argentino',
    type: 'MONEDA',
  };

  constructor(private readonly events: string[]) {
    super();
  }

  override async findByTicker(ticker: string): Promise<InstrumentInfo | null> {
    this.events.push('currency');
    return this.currency?.ticker === ticker ? this.currency : null;
  }

  override async findById(): Promise<InstrumentInfo | null> {
    return null;
  }

  override async search(): Promise<readonly InstrumentInfo[]> {
    return [];
  }

  override async findByIds(): Promise<readonly InstrumentInfo[]> {
    return [];
  }

  override async latestMarketData(): Promise<MarketDataQuote | null> {
    return null;
  }

  override async latestMarketDataFor(): Promise<readonly MarketDataQuote[]> {
    return [];
  }
}

class MemoryAccountLock extends AccountLock {
  missing = false;

  constructor(
    private readonly events: string[],
    private readonly unitOfWork: RecordingUnitOfWork,
  ) {
    super();
  }

  override async acquireForUser(): Promise<AccountId> {
    this.events.push('lock');

    if (!this.unitOfWork.active) {
      throw new Error('Account lock ran outside the transaction.');
    }

    if (this.missing) {
      throw new AccountNotFoundError();
    }

    return account;
  }
}

class FixedIds extends UuidGenerator {
  override generate(): string {
    return generatedOrderId;
  }
}

function harness(
  entries: AccountEntry[] = [],
  reserved: Account = Account.open(account),
) {
  const events: string[] = [];
  const unitOfWork = new RecordingUnitOfWork(events);
  const idempotency = new MemoryIdempotencyStore(events);
  const orders = new MemoryOrders(events, entries);
  const accounts = new MemoryAccounts(events, reserved);
  const instruments = new MemoryInstruments(events);
  const accountLock = new MemoryAccountLock(events, unitOfWork);
  unitOfWork.participants.push(idempotency, orders);
  const useCase = new SubmitCashMovement(
    idempotency,
    instruments,
    unitOfWork,
    accountLock,
    orders,
    new FixedIds(),
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

function command(
  side: SubmitCashMovementCommand['side'],
  amount = '1000.00',
  idempotencyKey = `${side}-${amount}`,
): SubmitCashMovementCommand {
  return { userId: owner, side, amount, idempotencyKey };
}

function deposit(amount: string): CashMovement {
  return CashMovement.cashIn({
    ...identity(1, 1n),
    instrumentId: peso,
    amount: Money.parse(amount),
  });
}

describe('SubmitCashMovement with fake repositories', () => {
  it('fills a cash in without changing reservations', async () => {
    const reserved = Account.open(account)
      .reserveCash(Money.parse('5000'))
      .reserveShares(stock, ShareQuantity.of(4n));
    const { orders, accounts, events, useCase } = harness([], reserved);

    const result = await useCase.execute(command('CASH_IN', '1500.00'));

    expect(result).toMatchObject({
      id: generatedOrderId,
      accountId: account,
      instrumentId: peso,
      side: 'CASH_IN',
      status: 'FILLED',
      amount: '1500',
      rejectionReason: null,
    });
    expect(orders.committed[0]?.settledCashDelta().toDecimalString()).toBe(
      '1500.00',
    );
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedCash.toDecimalString()).toBe('5000');
    expect(accounts.state.reservedSharesOf(stock)).toBe(4n);
    expect(events).not.toContain('orders.find');
    expect(events).not.toContain('accounts.save');
    expect(events.indexOf('lock')).toBeGreaterThan(events.indexOf('currency'));
    expect(events.indexOf('accounts.find')).toBeGreaterThan(
      events.lastIndexOf('idempotency.find'),
    );
  });

  it('fills a cash out that fits in the available cash and keeps the reserve', async () => {
    const reserved = Account.open(account).reserveCash(Money.parse('5000'));
    const { orders, accounts, useCase } = harness(
      [deposit('10000.00')],
      reserved,
    );

    const result = await useCase.execute(command('CASH_OUT', '5000.00'));

    expect(result.status).toBe('FILLED');
    expect(result.rejectionReason).toBeNull();
    expect(orders.committed[0]?.settledCashDelta().toDecimalString()).toBe(
      '-5000.00',
    );
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedCash.toDecimalString()).toBe('5000');
  });

  it('rejects a cash out that would spend reserved cash', async () => {
    const reserved = Account.open(account).reserveCash(Money.parse('5000'));
    const { orders, accounts, useCase } = harness(
      [deposit('10000.00')],
      reserved,
    );

    const rejected = await useCase.execute(command('CASH_OUT', '6000.00'));
    const filled = await useCase.execute(command('CASH_OUT', '3000.00'));

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('INSUFFICIENT_CASH');
    expect(rejected.side).toBe('CASH_OUT');
    expect(orders.committed[0]?.settledCashDelta().isZero()).toBe(true);
    expect(filled.status).toBe('FILLED');
    expect(accounts.saved).toHaveLength(0);
    expect(accounts.state.reservedCash.toDecimalString()).toBe('5000');
  });

  it('does not subtract a limit commitment that is not stored on the account', async () => {
    const parked = TradeOrder.limitOpen({
      ...identity(2, 60n),
      side: 'BUY',
      price: price('100.00'),
    });
    const { orders, useCase } = harness([deposit('10000.00'), parked]);

    const result = await useCase.execute(command('CASH_OUT', '5000.00'));

    expect(result.status).toBe('FILLED');
    expect(orders.committed).toHaveLength(1);
  });

  it('rejects an invalid or non-positive amount before persisting', async () => {
    const invalid = harness();
    await expect(
      invalid.useCase.execute(command('CASH_IN', 'abc')),
    ).rejects.toBeInstanceOf(InvalidMoneyError);
    expect(invalid.events).toEqual([]);

    const zero = harness([deposit('1000.00')]);
    await expect(
      zero.useCase.execute(command('CASH_OUT', '0')),
    ).rejects.toBeInstanceOf(NonPositiveAmountError);
    expect(zero.orders.added).toHaveLength(0);
    expect(zero.idempotency.saved).toHaveLength(0);

    const negative = harness([deposit('1000.00')]);
    await expect(
      negative.useCase.execute(command('CASH_IN', '-10')),
    ).rejects.toBeInstanceOf(NonPositiveAmountError);
    expect(negative.orders.committed).toHaveLength(0);
  });

  it('fails when ARS is missing or is not a currency', async () => {
    const missing = harness();
    missing.instruments.currency = null;
    await expect(
      missing.useCase.execute(command('CASH_IN')),
    ).rejects.toBeInstanceOf(CashCurrencyUnavailableError);
    expect(missing.events).not.toContain('transaction');

    const stockNamedArs = harness();
    stockNamedArs.instruments.currency = {
      id: stock,
      ticker: 'ARS',
      name: 'Not a currency',
      type: 'ACCIONES',
    };
    await expect(
      stockNamedArs.useCase.execute(command('CASH_OUT', '10')),
    ).rejects.toBeInstanceOf(CashCurrencyUnavailableError);
    expect(stockNamedArs.orders.added).toHaveLength(0);
  });

  it('replays the same request and conflicts when the request changes', async () => {
    const { idempotency, orders, useCase } = harness([deposit('10000.00')]);
    const original = command('CASH_IN', '1500.00', 'same-key');

    const first = await useCase.execute(original);
    const replay = await useCase.execute({ ...original, amount: '1500' });

    expect(replay).toEqual(first);
    expect(orders.committed).toHaveLength(1);

    await expect(
      useCase.execute({ ...original, amount: '10.00' }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(orders.committed).toHaveLength(1);
    expect(idempotency.committed).toHaveLength(1);
  });

  it('replays a rejected cash out without inserting another movement', async () => {
    const reserved = Account.open(account).reserveCash(Money.parse('5000'));
    const { orders, useCase } = harness([deposit('10000.00')], reserved);
    const original = command('CASH_OUT', '6000.00', 'rejected-key');

    const first = await useCase.execute(original);
    const replay = await useCase.execute(original);

    expect(first.status).toBe('REJECTED');
    expect(replay).toEqual(first);
    expect(orders.committed).toHaveLength(1);
  });

  it('rolls back the movement and the idempotency record together', async () => {
    const failedInsert = harness([deposit('1000.00')]);
    failedInsert.orders.failOnAdd = true;
    await expect(
      failedInsert.useCase.execute(command('CASH_IN', '10.00')),
    ).rejects.toThrow('cash insert failed');
    expect(failedInsert.orders.committed).toHaveLength(0);
    expect(failedInsert.idempotency.committed).toHaveLength(0);

    const failedIdempotency = harness([deposit('1000.00')]);
    failedIdempotency.idempotency.failOnSave = true;
    await expect(
      failedIdempotency.useCase.execute(command('CASH_OUT', '10.00')),
    ).rejects.toThrow('idempotency insert failed');
    expect(failedIdempotency.orders.added).toHaveLength(1);
    expect(failedIdempotency.orders.committed).toHaveLength(0);
    expect(failedIdempotency.idempotency.committed).toHaveLength(0);
    expect(failedIdempotency.accounts.saved).toHaveLength(0);
  });

  it('hashes equivalent amounts equally', () => {
    const left = submitCashMovementRequestHash(
      owner,
      'CASH_OUT',
      Money.parse('10.00'),
    );
    const right = submitCashMovementRequestHash(
      owner,
      'CASH_OUT',
      Money.parse('10'),
    );

    expect(left).toBe(right);
    expect(left).not.toBe(
      submitCashMovementRequestHash(owner, 'CASH_IN', Money.parse('10.00')),
    );
  });
});
