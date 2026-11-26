import { randomUUID } from 'node:crypto';

import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { Prisma } from '../../src/generated/prisma/client.js';
import {
  assertAccountReservationsMatchOrders,
  DevelopmentSeedError,
  seedDevelopmentDatabase,
} from '../../src/seed/development-seed.js';
import { challengeFixtureId } from '../../src/seed/fixture-id.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithLocalDatabase =
  databaseUrl && isLocalDatabase(databaseUrl) ? describe : describe.skip;

describeWithLocalDatabase('reservation consistency against PostgreSQL', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;
    const database = new URL(databaseUrl ?? '').pathname.replace(/^\//, '');

    if (rows[0]?.name !== database) {
      throw new Error(`Connected to ${rows[0]?.name ?? 'unknown'}.`);
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('keeps the development seed idempotent and rejects a conflicting id', async () => {
    await seedDevelopmentDatabase(databaseUrl ?? '');
    await seedDevelopmentDatabase(databaseUrl ?? '');

    const userId = challengeFixtureId('user', 1);
    const account = await prisma.account.findUniqueOrThrow({
      where: { userId },
    });
    const reservedBefore = new Prisma.Decimal(account.reservedCash).toString();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await prisma.user.update({
      where: { id: userId },
      data: { email: 'seed-conflict@test.local' },
    });

    try {
      await expect(
        seedDevelopmentDatabase(databaseUrl ?? ''),
      ).rejects.toBeInstanceOf(DevelopmentSeedError);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email,
      ).toBe('seed-conflict@test.local');
    } finally {
      await prisma.user.update({
        where: { id: userId },
        data: { email: user.email },
      });
    }

    const restored = await prisma.account.findUniqueOrThrow({
      where: { userId },
    });

    expect(new Prisma.Decimal(restored.reservedCash).toString()).toBe(
      reservedBefore,
    );
    expect(
      await prisma.accountReservedPosition.count({
        where: { accountId: account.id },
      }),
    ).toBe(0);
  });

  it('backfills several limit orders and rolls back an inconsistent reserve', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const owner = randomUUID();
        const funded = randomUUID();
        const empty = randomUUID();
        const stock = randomUUID();

        await tx.user.create({
          data: {
            id: owner,
            email: `reserve-backfill-${owner}@test.local`,
            account: {
              create: {
                id: funded,
                accountNumber: `reserve-backfill-${funded}`,
              },
            },
          },
        });
        await tx.user.create({
          data: {
            id: randomUUID(),
            email: `reserve-empty-${empty}@test.local`,
            account: {
              create: {
                id: empty,
                accountNumber: `reserve-empty-${empty}`,
              },
            },
          },
        });
        await tx.instrument.create({
          data: {
            id: stock,
            ticker: `Z${owner.replaceAll('-', '').slice(0, 8)}`.toUpperCase(),
            name: 'Reserve backfill instrument',
            type: 'ACCIONES',
          },
        });
        await tx.order.createMany({
          data: [
            limit(funded, stock, 'BUY', '10', '100'),
            limit(funded, stock, 'BUY', '4', '25.50'),
            limit(funded, stock, 'SELL', '3', '10'),
            limit(funded, stock, 'SELL', '5', '11'),
          ],
        });

        await expect(
          assertAccountReservationsMatchOrders(tx, [funded, empty]),
        ).rejects.toBeInstanceOf(DevelopmentSeedError);

        await tx.$executeRaw`
          UPDATE accounts AS account
          SET reserved_cash = COALESCE((
            SELECT SUM(orders.size * orders.price)
            FROM orders
            WHERE orders.account_id = account.id
              AND orders.side = 'BUY'
              AND orders.type = 'LIMIT'
              AND orders.status = 'NEW'
          ), 0)
          WHERE account.id = ${funded}::uuid
        `;
        await tx.$executeRaw`
          INSERT INTO account_reserved_positions (
            account_id, instrument_id, quantity
          )
          SELECT account_id, instrument_id, SUM(size)
          FROM orders
          WHERE account_id = ${funded}::uuid
            AND side = 'SELL'
            AND type = 'LIMIT'
            AND status = 'NEW'
          GROUP BY account_id, instrument_id
          HAVING SUM(size) > 0
        `;
        await assertAccountReservationsMatchOrders(tx, [funded, empty]);

        const position = await tx.accountReservedPosition.findUniqueOrThrow({
          where: {
            accountId_instrumentId: {
              accountId: funded,
              instrumentId: stock,
            },
          },
        });
        const settled = await tx.$queryRaw<Array<{ quantity: string }>>`
          SELECT COALESCE(SUM(
            CASE
              WHEN side = 'BUY' AND type = 'MARKET' AND status = 'FILLED'
                THEN size
              WHEN side = 'SELL' AND type = 'MARKET' AND status = 'FILLED'
                THEN -size
              ELSE 0
            END
          ), 0)::text AS quantity
          FROM orders
          WHERE account_id = ${funded}::uuid
            AND instrument_id = ${stock}::uuid
        `;
        const cash = await tx.account.findUniqueOrThrow({
          where: { id: funded },
        });

        expect(new Prisma.Decimal(cash.reservedCash).equals('1102')).toBe(true);
        expect(new Prisma.Decimal(position.quantity).equals('8')).toBe(true);
        expect(new Prisma.Decimal(settled[0]?.quantity ?? '1').isZero()).toBe(
          true,
        );
        expect(
          new Prisma.Decimal(
            (await tx.account.findUniqueOrThrow({ where: { id: empty } }))
              .reservedCash,
          ).isZero(),
        ).toBe(true);

        await tx.$executeRaw`
          UPDATE accounts
          SET reserved_cash = reserved_cash + 1
          WHERE id = ${funded}::uuid
        `;
        await expect(
          assertAccountReservationsMatchOrders(tx, [funded]),
        ).rejects.toBeInstanceOf(DevelopmentSeedError);

        throw new Error('rollback own reservation rows');
      }),
    ).rejects.toThrow('rollback own reservation rows');

    expect(
      await prisma.user.count({
        where: { email: { startsWith: 'reserve-backfill-' } },
      }),
    ).toBe(0);
  });
});

function limit(
  accountId: string,
  instrumentId: string,
  side: 'BUY' | 'SELL',
  size: string,
  price: string,
) {
  return {
    id: randomUUID(),
    accountId,
    instrumentId,
    side,
    type: 'LIMIT' as const,
    size,
    price,
    status: 'NEW' as const,
    placedAt: new Date('2026-02-01T00:00:00.000Z'),
  };
}

function isLocalDatabase(connectionString: string): boolean {
  const url = new URL(connectionString);

  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1'
  );
}
