import { describe, expect, it, vi } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import { uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import type { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { InvalidShareQuantityError } from '#orders/domain/errors/order-errors.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { OrderPersistenceError } from '#orders/infrastructure/prisma/order-persistence.error.js';
import { PrismaOrdersPortfolioData } from '#orders/infrastructure/prisma/prisma-orders-portfolio-data.js';

import { Prisma } from '../../../../src/generated/prisma/client.js';
import { fixtureUuid } from '../domain/order-fixture.js';

const user = uuid(fixtureUuid(7));
const account = fixtureUuid(3);
const stock = fixtureUuid(20);
const peso = fixtureUuid(1);
const maxShare = (10n ** 20n - 1n).toString();

function sameMoney(actual: string | undefined, expected: string): boolean {
  return Money.fromCalculation(actual ?? '0').equals(Money.parse(expected));
}

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('?');
}

function orderRow(
  overrides: Partial<{
    id: string;
    instrumentId: string;
    side: string;
    size: string;
    price: string | null;
    type: string | null;
    status: string;
    rejectionReason: string | null;
    ticker: string;
    instrumentType: string;
    reservedCash: string;
    reservedPositions: unknown;
  }> = {},
) {
  return {
    account_id: account,
    reserved_cash: new Prisma.Decimal(overrides.reservedCash ?? '0'),
    reserved_positions: overrides.reservedPositions ?? [],
    id: overrides.id ?? fixtureUuid(4),
    instrument_id: overrides.instrumentId ?? stock,
    side: overrides.side ?? 'BUY',
    size: new Prisma.Decimal(overrides.size ?? '1'),
    price:
      overrides.price === null
        ? null
        : new Prisma.Decimal(overrides.price ?? '10.00'),
    type: overrides.type === undefined ? 'MARKET' : overrides.type,
    status: overrides.status ?? 'FILLED',
    rejection_reason: overrides.rejectionReason ?? null,
    placed_at: new Date('2026-01-15T15:00:00.000Z'),
    instrument_ticker: overrides.ticker ?? 'GGAL',
    instrument_type: overrides.instrumentType ?? 'ACCIONES',
  };
}

function emptyAccount() {
  return {
    account_id: account,
    reserved_cash: new Prisma.Decimal('0'),
    reserved_positions: [],
    id: null,
    instrument_id: null,
    side: null,
    size: null,
    price: null,
    type: null,
    status: null,
    rejection_reason: null,
    placed_at: null,
    instrument_ticker: null,
    instrument_type: null,
  };
}

function createHarness() {
  const queryRaw = vi.fn();
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const provider = new PrismaClientProvider(prisma);
  const getClient = vi.spyOn(provider, 'getClient');
  const getTransactionClient = vi.spyOn(provider, 'getTransactionClient');

  return {
    queryRaw,
    getClient,
    getTransactionClient,
    portfolio: new PrismaOrdersPortfolioData(provider),
  };
}

describe('PrismaOrdersPortfolioData with a fake Prisma client', () => {
  it('returns null when the user has no account', async () => {
    const { queryRaw, getClient, getTransactionClient, portfolio } =
      createHarness();
    queryRaw.mockResolvedValue([]);

    await expect(portfolio.findByUserId(user)).resolves.toBeNull();

    const [statement, parameter] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    const sql = sqlText(statement);

    expect(parameter).toBe(user);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(sql).toContain('FROM accounts');
    expect(sql).toContain('accounts.reserved_cash');
    expect(sql).toContain('json_agg');
    expect(sql).toContain('FROM account_reserved_positions');
    expect(sql).toContain('quantity::text');
    expect(sql).not.toContain('JOIN account_reserved_positions');
    expect(sql).toContain('LEFT JOIN orders');
    expect(sql).toContain('LEFT JOIN instruments');
    expect(sql).toContain('instruments.ticker AS instrument_ticker');
    expect(sql).toContain('instruments.type AS instrument_type');
    expect(sql).toContain('accounts.user_id');
    expect(sql).not.toContain('FOR UPDATE');
    expect(sql).not.toContain(String(user));
    expect(getClient).toHaveBeenCalledOnce();
    expect(getTransactionClient).not.toHaveBeenCalled();
  });

  it('returns zero cash and no positions for an account without orders', async () => {
    const { queryRaw, portfolio } = createHarness();
    queryRaw.mockResolvedValue([emptyAccount()]);

    await expect(portfolio.findByUserId(user)).resolves.toEqual({
      accountId: account,
      settledCash: '0',
      reservedCash: '0',
      availableCash: '0',
      positions: [],
    });
  });

  it('folds real entities and omits a zero net quantity', async () => {
    const { queryRaw, portfolio } = createHarness();
    queryRaw.mockResolvedValue([
      orderRow({
        id: fixtureUuid(1),
        side: 'BUY',
        size: '5',
        price: '10.00',
        reservedCash: '16.00',
      }),
      orderRow({
        id: fixtureUuid(2),
        side: 'SELL',
        size: '5',
        price: '12.00',
        reservedCash: '16.00',
      }),
      orderRow({
        id: fixtureUuid(3),
        side: 'CASH_IN',
        size: '100.00',
        price: null,
        type: null,
        instrumentId: peso,
        ticker: 'ARS',
        instrumentType: 'MONEDA',
        reservedCash: '16.00',
      }),
      orderRow({
        id: fixtureUuid(4),
        type: 'LIMIT',
        status: 'NEW',
        side: 'BUY',
        size: '2',
        price: '8.00',
        reservedCash: '16.00',
      }),
    ]);

    const snapshot = await portfolio.findByUserId(user);

    expect(sameMoney(snapshot?.settledCash, '110')).toBe(true);
    expect(sameMoney(snapshot?.reservedCash, '16')).toBe(true);
    expect(sameMoney(snapshot?.availableCash, '94')).toBe(true);
    expect(snapshot?.positions).toEqual([]);
  });

  it('does not turn a limit order into a reserve when the account has none', async () => {
    const { queryRaw, portfolio } = createHarness();
    queryRaw.mockResolvedValue([
      orderRow({
        id: fixtureUuid(1),
        side: 'CASH_IN',
        size: '100.00',
        price: null,
        type: null,
        instrumentId: peso,
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
      orderRow({
        id: fixtureUuid(2),
        type: 'LIMIT',
        status: 'NEW',
        side: 'BUY',
        size: '2',
        price: '8.00',
      }),
    ]);

    const snapshot = await portfolio.findByUserId(user);

    expect(sameMoney(snapshot?.settledCash, '100')).toBe(true);
    expect(sameMoney(snapshot?.reservedCash, '0')).toBe(true);
    expect(sameMoney(snapshot?.availableCash, '100')).toBe(true);
  });

  it('shows an instrument that only has a share reservation', async () => {
    const { queryRaw, portfolio } = createHarness();
    queryRaw.mockResolvedValue([
      {
        ...emptyAccount(),
        reserved_positions: [{ instrument_id: stock, quantity: '6' }],
      },
    ]);

    const snapshot = await portfolio.findByUserId(user);

    expect(snapshot?.positions).toEqual([
      {
        instrumentId: stock,
        quantity: '0',
        reservedQuantity: '6',
        availableQuantity: '0',
      },
    ]);
  });

  it('keeps a negative available cash when reserves exceed settled cash', async () => {
    const { queryRaw, portfolio } = createHarness();
    queryRaw.mockResolvedValue([
      orderRow({
        side: 'CASH_IN',
        size: '1000.00',
        price: null,
        type: null,
        instrumentId: peso,
        ticker: 'ARS',
        instrumentType: 'MONEDA',
        reservedCash: '1500.00',
      }),
    ]);

    const snapshot = await portfolio.findByUserId(user);

    expect(sameMoney(snapshot?.availableCash, '-500')).toBe(true);
    expect(sameMoney(snapshot?.reservedCash, '1500')).toBe(true);
  });

  it('returns a negative quantity and a quantity above the persistable share limit', async () => {
    const { queryRaw, portfolio } = createHarness();
    const other = fixtureUuid(21);
    queryRaw.mockResolvedValue([
      orderRow({
        id: fixtureUuid(1),
        side: 'SELL',
        size: '4',
        reservedPositions: [{ instrument_id: stock, quantity: '2' }],
      }),
      orderRow({
        id: fixtureUuid(2),
        side: 'BUY',
        size: maxShare,
        instrumentId: other,
        ticker: 'YPF',
        reservedPositions: [{ instrument_id: stock, quantity: '2' }],
      }),
      orderRow({
        id: fixtureUuid(3),
        side: 'BUY',
        size: maxShare,
        instrumentId: other,
        ticker: 'YPF',
        reservedPositions: [{ instrument_id: stock, quantity: '2' }],
      }),
    ]);

    const snapshot = await portfolio.findByUserId(user);
    const oversized = snapshot?.positions[1]?.quantity ?? '0';

    const oversizedQuantity = ((10n ** 20n - 1n) * 2n).toString();

    expect(snapshot?.positions).toEqual([
      {
        instrumentId: stock,
        quantity: '-4',
        reservedQuantity: '2',
        availableQuantity: '0',
      },
      {
        instrumentId: other,
        quantity: oversizedQuantity,
        reservedQuantity: '0',
        availableQuantity: oversizedQuantity,
      },
    ]);
    expect(() => ShareQuantity.of(BigInt(oversized))).toThrow(
      InvalidShareQuantityError,
    );
  });

  it('keeps cash above 20 integer digits', async () => {
    const { queryRaw, portfolio } = createHarness();
    const amount = '9'.repeat(20);
    queryRaw.mockResolvedValue([
      orderRow({
        id: fixtureUuid(1),
        side: 'CASH_IN',
        size: amount,
        price: null,
        type: null,
        instrumentId: peso,
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
      orderRow({
        id: fixtureUuid(2),
        side: 'CASH_IN',
        size: amount,
        price: null,
        type: null,
        instrumentId: peso,
        ticker: 'ARS',
        instrumentType: 'MONEDA',
      }),
    ]);

    const snapshot = await portfolio.findByUserId(user);

    expect(snapshot?.settledCash).toBe(((10n ** 20n - 1n) * 2n).toString());
    expect(snapshot?.settledCash.startsWith('1')).toBe(true);
    expect(snapshot?.positions).toEqual([]);
  });

  it('rejects an incomplete or illegal order row', async () => {
    const incomplete = createHarness();
    incomplete.queryRaw.mockResolvedValue([
      { ...orderRow(), instrument_ticker: null, instrument_type: null },
    ]);
    const illegal = createHarness();
    illegal.queryRaw.mockResolvedValue([
      orderRow({ type: 'MARKET', status: 'NEW' }),
    ]);

    await expect(
      incomplete.portfolio.findByUserId(user),
    ).rejects.toBeInstanceOf(OrderPersistenceError);
    await expect(illegal.portfolio.findByUserId(user)).rejects.toBeInstanceOf(
      OrderPersistenceError,
    );
  });
});
