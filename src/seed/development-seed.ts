import { pathToFileURL } from 'node:url';

import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  type DevelopmentSeedPlan,
  type SeedAccount,
  type SeedInstrument,
  type SeedMarketData,
  type SeedOrder,
  type SeedUser,
  transformChallengeFixture,
} from './transform-challenge-fixture.js';

export class DevelopmentSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevelopmentSeedError';
  }
}

export function assertDevelopmentSeedAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.SEED_DEV !== '1') {
    throw new DevelopmentSeedError(
      'Development seed requires SEED_DEV=1 and refuses to run otherwise.',
    );
  }

  const connectionString = env.DATABASE_URL;

  if (!connectionString) {
    throw new DevelopmentSeedError('DATABASE_URL is not set.');
  }

  assertLocalDatabase(connectionString);
}

export async function seedDevelopmentDatabase(
  connectionString: string,
): Promise<DevelopmentSeedPlan> {
  assertLocalDatabase(connectionString);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const plan = transformChallengeFixture();

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const user of plan.users) {
          await insertUser(tx, user);
        }

        for (const account of plan.accounts) {
          await insertAccount(tx, account);
        }

        for (const instrument of plan.instruments) {
          await insertInstrument(tx, instrument);
        }

        for (const quote of plan.marketData) {
          await insertMarketData(tx, quote);
        }

        for (const order of plan.orders) {
          await insertOrder(tx, order);
        }

        await syncReservations(tx, plan);
        await assertAccountReservationsMatchOrders(
          tx,
          plan.accounts.map((account) => account.id),
        );
      },
      { timeout: 30_000 },
    );
  } finally {
    await prisma.$disconnect();
  }

  return plan;
}

function assertLocalDatabase(connectionString: string): void {
  const host = new URL(connectionString).hostname;

  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new DevelopmentSeedError(
      `Development seed refuses database host ${host}.`,
    );
  }
}

type SeedClient = Prisma.TransactionClient;

async function insertUser(tx: SeedClient, user: SeedUser): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO users (id, email)
    VALUES (${user.id}::uuid, ${user.email})
    ON CONFLICT (id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<Array<{ email: string }>>`
    SELECT email FROM users WHERE id = ${user.id}::uuid
  `;
  expectRow(rows[0], 'users', user.id);
  expectEqual('users', user.id, 'email', rows[0].email, user.email);
}

async function insertAccount(
  tx: SeedClient,
  account: SeedAccount,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO accounts (id, user_id, account_number)
    VALUES (${account.id}::uuid, ${account.userId}::uuid, ${account.accountNumber})
    ON CONFLICT (id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    Array<{ user_id: string; account_number: string }>
  >`
    SELECT user_id, account_number FROM accounts WHERE id = ${account.id}::uuid
  `;
  expectRow(rows[0], 'accounts', account.id);
  expectEqual(
    'accounts',
    account.id,
    'user_id',
    rows[0].user_id,
    account.userId,
  );
  expectEqual(
    'accounts',
    account.id,
    'account_number',
    rows[0].account_number,
    account.accountNumber,
  );
}

async function insertInstrument(
  tx: SeedClient,
  instrument: SeedInstrument,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO instruments (id, ticker, name, type)
    VALUES (${instrument.id}::uuid, ${instrument.ticker}, ${instrument.name}, ${instrument.type})
    ON CONFLICT (id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    Array<{ ticker: string; name: string; type: string }>
  >`
    SELECT ticker, name, type FROM instruments WHERE id = ${instrument.id}::uuid
  `;
  expectRow(rows[0], 'instruments', instrument.id);
  expectEqual(
    'instruments',
    instrument.id,
    'ticker',
    rows[0].ticker,
    instrument.ticker,
  );
  expectEqual(
    'instruments',
    instrument.id,
    'name',
    rows[0].name,
    instrument.name,
  );
  expectEqual(
    'instruments',
    instrument.id,
    'type',
    rows[0].type,
    instrument.type,
  );
}

async function insertMarketData(
  tx: SeedClient,
  quote: SeedMarketData,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO market_data (
      id, instrument_id, high, low, open, close, previous_close, observed_at
    )
    VALUES (
      ${quote.id}::uuid,
      ${quote.instrumentId}::uuid,
      ${quote.high}::numeric,
      ${quote.low}::numeric,
      ${quote.open}::numeric,
      ${quote.close}::numeric,
      ${quote.previousClose}::numeric,
      ${quote.observedAt}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    Array<{
      instrument_id: string;
      high: Prisma.Decimal;
      low: Prisma.Decimal;
      open: Prisma.Decimal;
      close: Prisma.Decimal;
      previous_close: Prisma.Decimal;
      observed_at: Date;
    }>
  >`
    SELECT instrument_id, high, low, open, close, previous_close, observed_at
    FROM market_data
    WHERE id = ${quote.id}::uuid
  `;
  expectRow(rows[0], 'market_data', quote.id);
  expectEqual(
    'market_data',
    quote.id,
    'instrument_id',
    rows[0].instrument_id,
    quote.instrumentId,
  );
  expectDecimal('market_data', quote.id, 'high', rows[0].high, quote.high);
  expectDecimal('market_data', quote.id, 'low', rows[0].low, quote.low);
  expectDecimal('market_data', quote.id, 'open', rows[0].open, quote.open);
  expectDecimal('market_data', quote.id, 'close', rows[0].close, quote.close);
  expectDecimal(
    'market_data',
    quote.id,
    'previous_close',
    rows[0].previous_close,
    quote.previousClose,
  );
  expectEqual(
    'market_data',
    quote.id,
    'observed_at',
    rows[0].observed_at.toISOString(),
    quote.observedAt.toISOString(),
  );
}

async function insertOrder(tx: SeedClient, order: SeedOrder): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO orders (
      id, account_id, instrument_id, side, size, price, type, status,
      rejection_reason, placed_at
    )
    VALUES (
      ${order.id}::uuid,
      ${order.accountId}::uuid,
      ${order.instrumentId}::uuid,
      ${order.side}::"OrderSide",
      ${order.size}::numeric,
      ${order.price}::numeric,
      ${order.type}::"OrderType",
      ${order.status}::"OrderStatus",
      ${order.rejectionReason}::"RejectionReason",
      ${order.placedAt}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  const rows = await tx.$queryRaw<
    Array<{
      account_id: string;
      instrument_id: string;
      side: string;
      size: Prisma.Decimal;
      price: Prisma.Decimal | null;
      type: string | null;
      status: string;
      rejection_reason: string | null;
      placed_at: Date;
    }>
  >`
    SELECT account_id, instrument_id, side, size, price, type, status,
           rejection_reason, placed_at
    FROM orders
    WHERE id = ${order.id}::uuid
  `;
  expectRow(rows[0], 'orders', order.id);
  expectEqual(
    'orders',
    order.id,
    'account_id',
    rows[0].account_id,
    order.accountId,
  );
  expectEqual(
    'orders',
    order.id,
    'instrument_id',
    rows[0].instrument_id,
    order.instrumentId,
  );
  expectEqual('orders', order.id, 'side', rows[0].side, order.side);
  expectDecimal('orders', order.id, 'size', rows[0].size, order.size);
  expectNullableDecimal(
    'orders',
    order.id,
    'price',
    rows[0].price,
    order.price,
  );
  expectEqual('orders', order.id, 'type', rows[0].type, order.type);
  expectEqual('orders', order.id, 'status', rows[0].status, order.status);
  expectEqual(
    'orders',
    order.id,
    'rejection_reason',
    rows[0].rejection_reason,
    order.rejectionReason,
  );
  expectEqual(
    'orders',
    order.id,
    'placed_at',
    rows[0].placed_at.toISOString(),
    order.placedAt.toISOString(),
  );
}

async function syncReservations(
  tx: SeedClient,
  plan: DevelopmentSeedPlan,
): Promise<void> {
  const reservedCash = new Map<string, Prisma.Decimal>(
    plan.accounts.map((account) => [account.id, new Prisma.Decimal(0)]),
  );
  const reservedShares = new Map<string, Map<string, Prisma.Decimal>>(
    plan.accounts.map((account) => [account.id, new Map()]),
  );

  for (const order of plan.orders) {
    if (
      order.type !== 'LIMIT' ||
      order.status !== 'NEW' ||
      order.price === null
    ) {
      continue;
    }

    if (order.side === 'BUY') {
      const current =
        reservedCash.get(order.accountId) ?? new Prisma.Decimal(0);
      reservedCash.set(
        order.accountId,
        current.plus(new Prisma.Decimal(order.size).times(order.price)),
      );
    }

    if (order.side === 'SELL') {
      const positions = reservedShares.get(order.accountId) ?? new Map();
      const current =
        positions.get(order.instrumentId) ?? new Prisma.Decimal(0);
      positions.set(order.instrumentId, current.plus(order.size));
      reservedShares.set(order.accountId, positions);
    }
  }

  for (const account of plan.accounts) {
    await syncReservedCash(
      tx,
      account.id,
      reservedCash.get(account.id) ?? new Prisma.Decimal(0),
    );
    await syncReservedShares(
      tx,
      account.id,
      reservedShares.get(account.id) ?? new Map(),
    );
  }
}

async function syncReservedCash(
  tx: SeedClient,
  accountId: string,
  expected: Prisma.Decimal,
): Promise<void> {
  const current = await readReservedCash(tx, accountId);

  if (current.equals(expected)) {
    return;
  }

  if (!current.isZero()) {
    throw new DevelopmentSeedError(
      `accounts ${accountId} reserved_cash is ${current.toString()}, expected ${expected.toString()}.`,
    );
  }

  await tx.$executeRaw`
    UPDATE accounts
    SET reserved_cash = ${expected.toString()}::numeric
    WHERE id = ${accountId}::uuid
      AND reserved_cash = 0
  `;
  const stored = await readReservedCash(tx, accountId);

  if (!stored.equals(expected)) {
    throw new DevelopmentSeedError(
      `accounts ${accountId} reserved_cash is ${stored.toString()}, expected ${expected.toString()}.`,
    );
  }
}

async function syncReservedShares(
  tx: SeedClient,
  accountId: string,
  expected: ReadonlyMap<string, Prisma.Decimal>,
): Promise<void> {
  const current = await readReservedShares(tx, accountId);

  if (sameShares(current, expected)) {
    return;
  }

  if (current.size > 0) {
    throw new DevelopmentSeedError(
      `accounts ${accountId} reserved shares do not match the seeded orders.`,
    );
  }

  for (const [instrumentId, quantity] of expected) {
    await tx.$executeRaw`
      INSERT INTO account_reserved_positions (account_id, instrument_id, quantity)
      VALUES (
        ${accountId}::uuid,
        ${instrumentId}::uuid,
        ${quantity.toString()}::numeric
      )
    `;
  }

  const stored = await readReservedShares(tx, accountId);

  if (!sameShares(stored, expected)) {
    throw new DevelopmentSeedError(
      `accounts ${accountId} reserved shares do not match the seeded orders.`,
    );
  }
}

export async function assertAccountReservationsMatchOrders(
  tx: SeedClient,
  accountIds: readonly string[],
): Promise<void> {
  if (accountIds.length === 0) {
    return;
  }

  const cash = await tx.$queryRaw<
    Array<{ account_id: string; reserved_cash: string; expected_cash: string }>
  >`
    SELECT
      account.id::text AS account_id,
      account.reserved_cash::text AS reserved_cash,
      COALESCE((
        SELECT SUM(orders.size * orders.price)::text
        FROM orders
        WHERE orders.account_id = account.id
          AND orders.side = 'BUY'
          AND orders.type = 'LIMIT'
          AND orders.status = 'NEW'
      ), '0') AS expected_cash
    FROM accounts AS account
    WHERE account.id = ANY(${[...accountIds]}::uuid[])
  `;
  const storedShares = await tx.$queryRaw<
    Array<{ account_id: string; instrument_id: string; quantity: string }>
  >`
    SELECT account_id::text, instrument_id::text, quantity::text
    FROM account_reserved_positions
    WHERE account_id = ANY(${[...accountIds]}::uuid[])
  `;
  const orderShares = await tx.$queryRaw<
    Array<{ account_id: string; instrument_id: string; quantity: string }>
  >`
    SELECT account_id::text, instrument_id::text, SUM(size)::text AS quantity
    FROM orders
    WHERE account_id = ANY(${[...accountIds]}::uuid[])
      AND side = 'SELL'
      AND type = 'LIMIT'
      AND status = 'NEW'
    GROUP BY account_id, instrument_id
  `;

  for (const row of cash) {
    if (!sameDecimal(row.reserved_cash, row.expected_cash)) {
      throw new DevelopmentSeedError(
        `accounts ${row.account_id} reserved_cash is ${row.reserved_cash}, expected ${row.expected_cash} from BUY LIMIT NEW orders.`,
      );
    }
  }

  if (shareKey(storedShares) !== shareKey(orderShares)) {
    throw new DevelopmentSeedError(
      'Reserved share positions do not match SELL LIMIT NEW orders.',
    );
  }
}

async function readReservedCash(
  tx: SeedClient,
  accountId: string,
): Promise<Prisma.Decimal> {
  const rows = await tx.$queryRaw<Array<{ reserved_cash: string }>>`
    SELECT reserved_cash::text AS reserved_cash
    FROM accounts
    WHERE id = ${accountId}::uuid
  `;
  expectRow(rows[0], 'accounts', accountId);
  return new Prisma.Decimal(rows[0].reserved_cash);
}

async function readReservedShares(
  tx: SeedClient,
  accountId: string,
): Promise<Map<string, Prisma.Decimal>> {
  const rows = await tx.$queryRaw<
    Array<{ instrument_id: string; quantity: string }>
  >`
    SELECT instrument_id::text, quantity::text
    FROM account_reserved_positions
    WHERE account_id = ${accountId}::uuid
  `;

  return new Map(
    rows.map((row) => [row.instrument_id, new Prisma.Decimal(row.quantity)]),
  );
}

function sameShares(
  actual: ReadonlyMap<string, Prisma.Decimal>,
  expected: ReadonlyMap<string, Prisma.Decimal>,
): boolean {
  if (actual.size !== expected.size) {
    return false;
  }

  for (const [instrumentId, quantity] of expected) {
    const stored = actual.get(instrumentId);

    if (!stored || !stored.equals(quantity)) {
      return false;
    }
  }

  return true;
}

function sameDecimal(actual: string, expected: string): boolean {
  return new Prisma.Decimal(actual).equals(new Prisma.Decimal(expected));
}

function shareKey(
  rows: readonly {
    account_id: string;
    instrument_id: string;
    quantity: string;
  }[],
): string {
  return rows
    .map(
      (row) =>
        `${row.account_id}:${row.instrument_id}:${new Prisma.Decimal(row.quantity).toString()}`,
    )
    .sort()
    .join('|');
}

function expectRow<T>(
  row: T | undefined,
  table: string,
  id: string,
): asserts row is T {
  if (!row) {
    throw new DevelopmentSeedError(`${table} ${id} was not inserted.`);
  }
}

function expectEqual(
  table: string,
  id: string,
  field: string,
  actual: unknown,
  expected: unknown,
): void {
  if (actual !== expected) {
    throw new DevelopmentSeedError(
      `${table} ${id} ${field} is ${String(actual)}, expected ${String(expected)}.`,
    );
  }
}

function expectDecimal(
  table: string,
  id: string,
  field: string,
  actual: Prisma.Decimal,
  expected: string,
): void {
  if (!new Prisma.Decimal(actual).equals(new Prisma.Decimal(expected))) {
    throw new DevelopmentSeedError(
      `${table} ${id} ${field} is ${actual.toString()}, expected ${expected}.`,
    );
  }
}

function expectNullableDecimal(
  table: string,
  id: string,
  field: string,
  actual: Prisma.Decimal | null,
  expected: string | null,
): void {
  if (expected === null) {
    expectEqual(table, id, field, actual, null);
    return;
  }

  if (actual === null) {
    throw new DevelopmentSeedError(
      `${table} ${id} ${field} is null, expected ${expected}.`,
    );
  }

  expectDecimal(table, id, field, actual, expected);
}

async function main(): Promise<void> {
  assertDevelopmentSeedAllowed();
  const plan = await seedDevelopmentDatabase(process.env.DATABASE_URL ?? '');

  for (const deviation of plan.deviations) {
    console.log(`${deviation.code}: ${deviation.detail}`);
  }

  console.log(
    `Development seed ready: ${plan.users.length} users, ${plan.instruments.length} instruments, ${plan.marketData.length} quotes, ${plan.orders.length} orders.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
