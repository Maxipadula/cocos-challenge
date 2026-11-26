import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { Account } from '#orders/domain/entities/account.js';
import { accountId } from '#orders/domain/value-objects/account-id.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { PrismaAccountRepository } from '#orders/infrastructure/prisma/prisma-account-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const legacyDatabase =
  databaseUrl !== undefined && isLegacyTestDatabase(databaseUrl);
const describeWithLegacyDatabase = legacyDatabase ? describe : describe.skip;

const largeQuantity = 10n ** 30n + 1n;

describeWithLegacyDatabase('PrismaAccountRepository against PostgreSQL', () => {
  let prisma: PrismaService;
  let repository: PrismaAccountRepository;
  let unitOfWork: PrismaUnitOfWork;
  const ownedAccountIds: string[] = [];
  const ownedInstrumentIds: string[] = [];
  const ownedUserIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl || !isLegacyTestDatabase(databaseUrl)) {
      throw new Error(
        'Refusing to migrate a database other than local cocos_legacy_test.',
      );
    }

    prisma = new PrismaService();
    await prisma.$connect();
    await assertConnectedDatabase();
    execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
    repository = new PrismaAccountRepository(new PrismaClientProvider(prisma));
    unitOfWork = new PrismaUnitOfWork(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanupOwnedRows();
      await prisma.$disconnect();
    }
  });

  it('backfills the seeded accounts without changing their orders', async () => {
    await expectReserved('emiliano@test.com', '125500', 0);
    await expectReserved('jose@test.com', '0', 0);
    await expectReserved('francisco@test.com', '0', 0);
    await expectReserved('juan@test.com', '0', 0);
  });

  it('saves and reloads reserved cash and share positions', async () => {
    const owned = await insertOwnedAccount();
    const firstInstrument = instrumentId(owned.instruments[0] ?? '');
    const secondInstrument = instrumentId(owned.instruments[1] ?? '');
    const reserved = Account.reconstitute({
      id: accountId(owned.accountId),
      reservedCash: Money.parse('125500.123456789012345678'),
      reservedShares: [
        { instrumentId: firstInstrument, quantity: 4n },
        { instrumentId: secondInstrument, quantity: largeQuantity },
      ],
    });

    await unitOfWork.run(() => repository.save(reserved));

    const loaded = await unitOfWork.run(() =>
      repository.findById(accountId(owned.accountId)),
    );
    const stored = await storedReservation(owned.accountId);

    expect(
      loaded?.reservedCash.equals(Money.parse('125500.123456789012345678')),
    ).toBe(true);
    expect(loaded?.reservedSharesOf(firstInstrument)).toBe(4n);
    expect(loaded?.reservedSharesOf(secondInstrument)).toBe(largeQuantity);
    expect(stored.quantities).toContain(largeQuantity.toString());
    expect(stored.quantities.some((quantity) => quantity.includes('e'))).toBe(
      false,
    );

    const updated = loaded
      ?.releaseCash(Money.parse('500.123456789012345678'))
      .releaseShares(firstInstrument, ShareQuantity.of(4n))
      .releaseShares(secondInstrument, ShareQuantity.of(1n));

    await unitOfWork.run(() => repository.save(updated ?? reserved));

    const reloaded = await unitOfWork.run(() =>
      repository.findById(accountId(owned.accountId)),
    );
    const afterUpdate = await storedReservation(owned.accountId);

    expect(reloaded?.reservedCash.equals(Money.parse('125000'))).toBe(true);
    expect(reloaded?.reservedSharesOf(firstInstrument)).toBe(0n);
    expect(reloaded?.reservedSharesOf(secondInstrument)).toBe(
      largeQuantity - 1n,
    );
    expect(afterUpdate.quantities).toEqual([(largeQuantity - 1n).toString()]);
  });

  it('rolls back reserved cash and positions together', async () => {
    const owned = await insertOwnedAccount();
    const reserved = Account.open(accountId(owned.accountId))
      .reserveCash(Money.parse('80.00'))
      .reserveShares(
        instrumentId(owned.instruments[0] ?? ''),
        ShareQuantity.of(6n),
      );

    await expect(
      unitOfWork.run(async () => {
        await repository.save(reserved);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const stored = await storedReservation(owned.accountId);

    expect(Money.fromCalculation(stored.reservedCash).isZero()).toBe(true);
    expect(stored.quantities).toEqual([]);
  });

  async function assertConnectedDatabase(): Promise<void> {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT current_database() AS name
    `;

    if (rows[0]?.name !== 'cocos_legacy_test') {
      throw new Error(
        `Refusing to migrate database ${rows[0]?.name ?? 'unknown'}.`,
      );
    }
  }

  async function expectReserved(
    email: string,
    reservedCash: string,
    positions: number,
  ): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { account: true },
    });
    const id = user.account?.id;

    if (!id) {
      throw new Error(`${email} has no account.`);
    }

    const loaded = await unitOfWork.run(() =>
      repository.findById(accountId(id)),
    );
    const stored = await storedReservation(id);

    expect(loaded?.reservedCash.equals(Money.parse(reservedCash))).toBe(true);
    expect(loaded?.reservedSharePositions()).toHaveLength(positions);
    expect(
      Money.fromCalculation(stored.reservedCash).equals(
        Money.parse(reservedCash),
      ),
    ).toBe(true);
    expect(stored.quantities).toHaveLength(positions);
  }

  async function storedReservation(id: string): Promise<{
    reservedCash: string;
    quantities: string[];
  }> {
    const rows = await prisma.$queryRaw<
      { reserved_cash: string; quantity: string | null }[]
    >`
      SELECT
        accounts.reserved_cash::text AS reserved_cash,
        positions.quantity::text AS quantity
      FROM accounts
      LEFT JOIN account_reserved_positions AS positions
        ON positions.account_id = accounts.id
      WHERE accounts.id = ${id}::uuid
      ORDER BY positions.instrument_id
    `;

    return {
      reservedCash: rows[0]?.reserved_cash ?? '',
      quantities: rows.flatMap((row) =>
        row.quantity === null ? [] : [row.quantity],
      ),
    };
  }

  async function insertOwnedAccount(): Promise<{
    accountId: string;
    instruments: [string, string];
  }> {
    const user = randomUUID();
    const ownedAccount = randomUUID();
    const firstInstrument = randomUUID();
    const secondInstrument = randomUUID();
    ownedUserIds.push(user);
    ownedAccountIds.push(ownedAccount);
    ownedInstrumentIds.push(firstInstrument, secondInstrument);

    await prisma.user.create({
      data: {
        id: user,
        email: `account-repo-${user}@test.local`,
        account: {
          create: {
            id: ownedAccount,
            accountNumber: `account-repo-${ownedAccount}`,
          },
        },
      },
    });
    await prisma.instrument.createMany({
      data: [
        {
          id: firstInstrument,
          ticker: ticker('A'),
          name: 'Account repository instrument',
          type: 'ACCIONES',
        },
        {
          id: secondInstrument,
          ticker: ticker('B'),
          name: 'Account repository instrument',
          type: 'ACCIONES',
        },
      ],
    });

    return {
      accountId: ownedAccount,
      instruments: [firstInstrument, secondInstrument],
    };
  }

  async function cleanupOwnedRows(): Promise<void> {
    if (ownedAccountIds.length > 0) {
      await prisma.accountReservedPosition.deleteMany({
        where: { accountId: { in: ownedAccountIds } },
      });
      await prisma.account.deleteMany({
        where: { id: { in: ownedAccountIds } },
      });
    }

    if (ownedInstrumentIds.length > 0) {
      await prisma.instrument.deleteMany({
        where: { id: { in: ownedInstrumentIds } },
      });
    }

    if (ownedUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: ownedUserIds } },
      });
    }
  }
});

function ticker(prefix: string): string {
  return `${prefix}${randomUUID().replaceAll('-', '').slice(0, 8)}`.toUpperCase();
}

function isLegacyTestDatabase(connectionString: string): boolean {
  const url = new URL(connectionString);
  const database = url.pathname.replace(/^\//, '').split('?')[0];
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1';

  return local && database === 'cocos_legacy_test';
}
