import { describe, expect, it, vi } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import {
  ActiveTransactionRequiredError,
  PrismaClientProvider,
} from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { CashMovement } from '#orders/domain/entities/cash-movement.js';
import { TradeOrder } from '#orders/domain/entities/trade-order.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { OrderPersistenceError } from '#orders/infrastructure/prisma/order-persistence.error.js';
import { PrismaOrderRepository } from '#orders/infrastructure/prisma/prisma-order-repository.js';

import { Prisma } from '../../../../src/generated/prisma/client.js';
import {
  account,
  fixtureUuid,
  identity,
  peso,
  placedAt,
  price,
} from '../domain/order-fixture.js';

const largeShare = (2n ** 53n + 1n).toString();
const maxShare = (10n ** 20n - 1n).toString();

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('?');
}

function row(
  overrides: Partial<{
    id: string;
    side: string;
    size: string;
    price: string | null;
    type: string | null;
    status: string;
    rejectionReason: string | null;
    ticker: string;
    instrumentType: string;
  }> = {},
) {
  return {
    id: overrides.id ?? fixtureUuid(4),
    account_id: account,
    instrument_id: fixtureUuid(20),
    side: overrides.side ?? 'BUY',
    size: new Prisma.Decimal(overrides.size ?? '3'),
    price:
      overrides.price === null
        ? null
        : new Prisma.Decimal(overrides.price ?? '10.50'),
    type: overrides.type === undefined ? 'LIMIT' : overrides.type,
    status: overrides.status ?? 'NEW',
    rejection_reason: overrides.rejectionReason ?? null,
    placed_at: new Date('2026-01-15T15:00:00.000Z'),
    instrument_ticker: overrides.ticker ?? 'GGAL',
    instrument_type: overrides.instrumentType ?? 'ACCIONES',
  };
}

function createHarness() {
  const findMany = vi.fn();
  const create = vi.fn();
  const updateMany = vi.fn();
  const queryRaw = vi.fn();
  const rootCreate = vi.fn();
  const transaction = {
    order: { findMany, create, updateMany },
    $queryRaw: queryRaw,
  };
  const prisma = {
    order: { findMany: vi.fn(), create: rootCreate, updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(
      async (work: (current: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    ),
  } as unknown as PrismaService;
  const provider = new PrismaClientProvider(prisma);
  const getClient = vi.spyOn(provider, 'getClient');
  const getTransactionClient = vi.spyOn(provider, 'getTransactionClient');

  return {
    findMany,
    create,
    updateMany,
    queryRaw,
    rootCreate,
    getClient,
    getTransactionClient,
    unitOfWork: new PrismaUnitOfWork(prisma),
    repository: new PrismaOrderRepository(provider),
  };
}

describe('PrismaOrderRepository', () => {
  it('returns an empty account', async () => {
    const { queryRaw, findMany, getClient, unitOfWork, repository } =
      createHarness();
    queryRaw.mockResolvedValue([]);

    await expect(
      unitOfWork.run(() => repository.findByAccount(account)),
    ).resolves.toEqual([]);

    const [statement, accountParameter] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    const sql = sqlText(statement);

    expect(accountParameter).toBe(account);
    expect(sql).toContain('orders.*');
    expect(sql).toContain('instruments.ticker AS instrument_ticker');
    expect(sql).toContain('instruments.type AS instrument_type');
    expect(sql).not.toContain(String(account));
    expect(findMany).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('reconstitutes every legal trade and cash state without recalculating cash', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([
      row({ id: fixtureUuid(1), type: 'MARKET', status: 'FILLED' }),
      row({
        id: fixtureUuid(2),
        type: 'MARKET',
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_CASH',
      }),
      row({ id: fixtureUuid(3), status: 'NEW' }),
      row({
        id: fixtureUuid(4),
        side: 'SELL',
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_SHARES',
      }),
      row({ id: fixtureUuid(5), status: 'CANCELLED' }),
      row({
        id: fixtureUuid(6),
        side: 'CASH_IN',
        size: '1500.50',
        price: null,
        type: null,
        status: 'FILLED',
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
      row({
        id: fixtureUuid(7),
        side: 'CASH_OUT',
        size: '40.50',
        price: null,
        type: null,
        status: 'FILLED',
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
      row({
        id: fixtureUuid(8),
        side: 'CASH_OUT',
        size: '80.00',
        price: null,
        type: null,
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_CASH',
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
    ]);

    const entries = await unitOfWork.run(() =>
      repository.findByAccount(account),
    );

    expect(entries.map((entry) => entry.id)).toEqual([
      fixtureUuid(1),
      fixtureUuid(2),
      fixtureUuid(3),
      fixtureUuid(4),
      fixtureUuid(5),
      fixtureUuid(6),
      fixtureUuid(7),
      fixtureUuid(8),
    ]);
    expect(entries[0]).toBeInstanceOf(TradeOrder);
    expect((entries[0] as TradeOrder).status).toBe('FILLED');
    expect((entries[1] as TradeOrder).rejectionReason).toBe(
      'INSUFFICIENT_CASH',
    );
    expect((entries[2] as TradeOrder).status).toBe('NEW');
    expect((entries[3] as TradeOrder).rejectionReason).toBe(
      'INSUFFICIENT_SHARES',
    );
    expect((entries[4] as TradeOrder).status).toBe('CANCELLED');
    expect(entries[5]).toBeInstanceOf(CashMovement);
    expect(
      (entries[5] as CashMovement)
        .settledCashDelta()
        .equals(Money.parse('1500.50')),
    ).toBe(true);
    expect(
      (entries[6] as CashMovement)
        .settledCashDelta()
        .equals(Money.parse('-40.50')),
    ).toBe(true);
    expect((entries[7] as CashMovement).settledCashDelta().isZero()).toBe(true);
    expect(entries.every((entry) => entry.accountId === account)).toBe(true);
  });

  it('keeps a share count above the safe integer range', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    const exactPrice = `12.${'3'.repeat(18)}`;
    queryRaw.mockResolvedValue([
      row({
        type: 'MARKET',
        status: 'FILLED',
        size: largeShare,
        price: exactPrice,
      }),
    ]);

    const [entry] = await unitOfWork.run(() =>
      repository.findByAccount(account),
    );

    expect((entry as TradeOrder).size.toBigInt().toString()).toBe(largeShare);
    expect(
      (entry as TradeOrder).price
        .multiply(ShareQuantity.of(1n))
        .toDecimalString(),
    ).toBe(exactPrice);
  });

  it('keeps the order type distinct from the instrument type', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([
      row({
        id: fixtureUuid(1),
        type: 'LIMIT',
        status: 'NEW',
        ticker: 'GGAL',
        instrumentType: 'ACCION',
      }),
      row({
        id: fixtureUuid(2),
        type: 'MARKET',
        status: 'FILLED',
        ticker: 'GGAL',
        instrumentType: 'ACCION',
      }),
      row({
        id: fixtureUuid(3),
        side: 'CASH_IN',
        size: '1500.50',
        price: null,
        type: null,
        status: 'FILLED',
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
    ]);

    const entries = await unitOfWork.run(() =>
      repository.findByAccount(account),
    );

    expect((entries[0] as TradeOrder).type).toBe('LIMIT');
    expect((entries[1] as TradeOrder).type).toBe('MARKET');
    expect(
      (entries[2] as CashMovement)
        .settledCashDelta()
        .equals(Money.parse('1500.50')),
    ).toBe(true);
  });

  it('rejects a cash movement that does not reference ARS', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([
      {
        ...row({
          side: 'CASH_IN',
          price: null,
          type: null,
          status: 'FILLED',
          ticker: 'GGAL',
          instrumentType: 'MONEDA',
        }),
        ticker: 'ARS',
      },
    ]);

    await expect(
      unitOfWork.run(() => repository.findByAccount(account)),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
  });

  it('rejects a trade that references a currency instrument', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([
      row({ instrumentType: 'MONEDA', ticker: 'ARS' }),
    ]);

    await expect(
      unitOfWork.run(() => repository.findByAccount(account)),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
  });

  it('rejects an illegal stored combination', async () => {
    const illegalState = createHarness();
    illegalState.queryRaw.mockResolvedValue([
      row({ type: 'MARKET', status: 'NEW' }),
    ]);
    const mismatchedReason = createHarness();
    mismatchedReason.queryRaw.mockResolvedValue([
      row({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_SHARES',
      }),
    ]);
    const fractionalSize = createHarness();
    fractionalSize.queryRaw.mockResolvedValue([
      row({ type: 'MARKET', status: 'FILLED', size: '1.50' }),
    ]);

    await expect(
      illegalState.unitOfWork.run(() =>
        illegalState.repository.findByAccount(account),
      ),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
    await expect(
      mismatchedReason.unitOfWork.run(() =>
        mismatchedReason.repository.findByAccount(account),
      ),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
    await expect(
      fractionalSize.unitOfWork.run(() =>
        fractionalSize.repository.findByAccount(account),
      ),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
  });

  it('persists each legal trade with the original id and exact decimals', async () => {
    const { create, rootCreate, getClient, unitOfWork, repository } =
      createHarness();
    create.mockResolvedValue({});
    const orders = [
      TradeOrder.marketFilled({
        ...identity(11, BigInt(largeShare)),
        side: 'BUY',
        price: price(`12.${'3'.repeat(18)}`),
      }),
      TradeOrder.marketRejected({
        ...identity(12, 2n),
        side: 'BUY',
        price: price('10.50'),
        reason: 'INSUFFICIENT_CASH',
      }),
      TradeOrder.limitOpen({
        ...identity(13, BigInt(maxShare)),
        side: 'SELL',
        price: price('1.00'),
      }),
      TradeOrder.limitRejected({
        ...identity(14, 4n),
        side: 'SELL',
        price: price('9.00'),
        reason: 'INSUFFICIENT_SHARES',
      }),
    ];

    await unitOfWork.run(async () => {
      for (const order of orders) {
        await repository.add(order);
      }
    });

    expect(getClient).not.toHaveBeenCalled();
    expect(rootCreate).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(4);

    const first = create.mock.calls[0]?.[0].data;
    expect(first.id).toBe(orders[0]?.id);
    expect(first.accountId).toBe(account);
    expect(first.side).toBe('BUY');
    expect(first.type).toBe('MARKET');
    expect(first.status).toBe('FILLED');
    expect(first.size).toEqual(new Prisma.Decimal(largeShare));
    expect(first.price.equals(new Prisma.Decimal(`12.${'3'.repeat(18)}`))).toBe(
      true,
    );
    expect(typeof first.size.toString()).toBe('string');
    expect(create.mock.calls[1]?.[0].data.rejectionReason).toBe(
      'INSUFFICIENT_CASH',
    );
    expect(create.mock.calls[2]?.[0].data.size).toEqual(
      new Prisma.Decimal(maxShare),
    );
    expect(create.mock.calls[2]?.[0].data.status).toBe('NEW');
    expect(create.mock.calls[3]?.[0].data.status).toBe('REJECTED');
  });

  it('persists a cash movement with a decimal amount and no price', async () => {
    const { create, getClient, unitOfWork, repository } = createHarness();
    create.mockResolvedValue({});
    const movement = CashMovement.cashOut({
      ...identity(15, 1n),
      instrumentId: peso,
      amount: Money.parse('40.50'),
      placedAt,
      availableCash: Money.parse('10.00'),
    });

    await unitOfWork.run(() => repository.addCashMovement(movement));

    const data = create.mock.calls[0]?.[0].data;

    expect(getClient).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      id: movement.id,
      side: 'CASH_OUT',
      price: null,
      type: null,
      status: 'REJECTED',
      rejectionReason: 'INSUFFICIENT_CASH',
    });
    expect(data.size).toEqual(new Prisma.Decimal('40.50'));
  });

  it('locks only a buy or sell row for the requested account and order', async () => {
    const { queryRaw, unitOfWork, repository } = createHarness();
    queryRaw.mockResolvedValue([]);
    const tradeId = identity(4, 1n).id;

    await expect(
      unitOfWork.run(() => repository.findTradeForUpdate(account, tradeId)),
    ).resolves.toBeNull();

    const [statement, accountParameter, orderParameter] = queryRaw.mock
      .calls[0] as [TemplateStringsArray, string, string];
    const sql = sqlText(statement);

    expect(accountParameter).toBe(account);
    expect(orderParameter).toBe(tradeId);
    expect(sql).toContain('FOR UPDATE OF orders');
    expect(sql).toContain("side IN ('BUY', 'SELL')");
    expect(sql).toContain('instruments.ticker AS instrument_ticker');
    expect(sql).toContain('instruments.type AS instrument_type');
    expect(sql).not.toContain(String(account));
  });

  it('returns null for a cash row and rejects a currency trade returned by the lock query', async () => {
    const cash = createHarness();
    cash.queryRaw.mockResolvedValue([
      row({ side: 'CASH_IN', price: null, type: null }),
    ]);

    await expect(
      cash.unitOfWork.run(() =>
        cash.repository.findTradeForUpdate(account, identity(4, 1n).id),
      ),
    ).resolves.toBeNull();

    const currency = createHarness();
    currency.queryRaw.mockResolvedValue([
      row({ instrumentType: 'MONEDA', ticker: 'ARS' }),
    ]);

    await expect(
      currency.unitOfWork.run(() =>
        currency.repository.findTradeForUpdate(account, identity(4, 1n).id),
      ),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
  });

  it('updates only the status of a cancelled limit order', async () => {
    const { updateMany, getClient, unitOfWork, repository } = createHarness();
    updateMany.mockResolvedValue({ count: 1 });
    const cancelled = TradeOrder.limitOpen({
      ...identity(4, 3n),
      side: 'BUY',
      price: price('10.50'),
    }).cancel();

    await unitOfWork.run(() => repository.update(cancelled));

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: cancelled.id,
        accountId: account,
        side: { in: ['BUY', 'SELL'] },
        type: 'LIMIT',
        status: 'NEW',
      },
      data: { status: 'CANCELLED' },
    });
    expect(getClient).not.toHaveBeenCalled();
  });

  it('rejects an update that is not a cancellation and a missing row', async () => {
    const { updateMany, unitOfWork, repository } = createHarness();
    const open = TradeOrder.limitOpen({
      ...identity(4, 3n),
      side: 'BUY',
      price: price('10.50'),
    });
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      unitOfWork.run(() => repository.update(open)),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
    expect(updateMany).not.toHaveBeenCalled();

    await expect(
      unitOfWork.run(() => repository.update(open.cancel())),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('propagates transaction, read, insert and update failures', async () => {
    const outside = createHarness();
    await expect(
      outside.repository.findByAccount(account),
    ).rejects.toBeInstanceOf(ActiveTransactionRequiredError);

    const read = createHarness();
    const readFailure = new Error('read failed');
    read.queryRaw.mockRejectedValue(readFailure);
    await expect(
      read.unitOfWork.run(() => read.repository.findByAccount(account)),
    ).rejects.toBe(readFailure);

    const insert = createHarness();
    const insertFailure = new Error('insert failed');
    insert.create.mockRejectedValue(insertFailure);
    await expect(
      insert.unitOfWork.run(() =>
        insert.repository.add(
          TradeOrder.limitOpen({
            ...identity(4, 1n),
            side: 'BUY',
            price: price('1.00'),
          }),
        ),
      ),
    ).rejects.toBe(insertFailure);

    const update = createHarness();
    const updateFailure = new Error('update failed');
    update.updateMany.mockRejectedValue(updateFailure);
    await expect(
      update.unitOfWork.run(() =>
        update.repository.update(
          TradeOrder.limitOpen({
            ...identity(4, 1n),
            side: 'BUY',
            price: price('1.00'),
          }).cancel(),
        ),
      ),
    ).rejects.toBe(updateFailure);
  });
});
