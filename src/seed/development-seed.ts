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
