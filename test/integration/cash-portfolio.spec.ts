import { randomUUID } from 'node:crypto';

import 'dotenv/config';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Money } from '#shared/domain/value-objects/money.js';
import { uuid } from '#shared/domain/value-objects/uuid.js';
import { PrismaClientProvider } from '#shared/infrastructure/prisma/prisma-client.provider.js';
import { PrismaIdempotencyStore } from '#shared/infrastructure/prisma/prisma-idempotency-store.js';
import { PrismaUnitOfWork } from '#shared/infrastructure/prisma/prisma-unit-of-work.js';
import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';
import { NodeUuidGenerator } from '#shared/infrastructure/uuid/node-uuid-generator.js';

import { PrismaInstrumentQueries } from '#instruments/infrastructure/prisma/prisma-instrument-queries.js';
import { userId } from '#orders/application/types/user-id.js';
import { SubmitCashMovement } from '#orders/application/use-cases/submit-cash-movement.js';
import { SubmitTradeOrder } from '#orders/application/use-cases/submit-trade-order.js';
import { instrumentId } from '#orders/domain/value-objects/instrument-id.js';
import { ShareQuantity } from '#orders/domain/value-objects/share-quantity.js';
import { UnitPrice } from '#orders/domain/value-objects/unit-price.js';
import { PrismaAccountLock } from '#orders/infrastructure/prisma/prisma-account-lock.js';
import { PrismaAccountRepository } from '#orders/infrastructure/prisma/prisma-account-repository.js';
import { PrismaOrderRepository } from '#orders/infrastructure/prisma/prisma-order-repository.js';
import { PrismaOrdersPortfolioData } from '#orders/infrastructure/prisma/prisma-orders-portfolio-data.js';
import {
  GetPortfolio,
  type Portfolio,
} from '#portfolio/application/use-cases/get-portfolio.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithLegacyDatabase =
  databaseUrl !== undefined && isLegacyTestDatabase(databaseUrl)
    ? describe
    : describe.skip;

describeWithLegacyDatabase(
  'cash movements reflected by Portfolio against PostgreSQL',
  () => {
    let prisma: PrismaService;
    let portfolio: GetPortfolio;
    let cash: SubmitCashMovement;
    let trades: SubmitTradeOrder;
    const ownedUsers: string[] = [];
    const ownedAccounts: string[] = [];
    const ownedInstruments: string[] = [];
    const ownedQuotes: string[] = [];

    beforeAll(async () => {
      if (!databaseUrl || !isLegacyTestDatabase(databaseUrl)) {
        throw new Error(
          'Refusing to use a database other than local cocos_legacy_test.',
        );
      }

      prisma = new PrismaService();
      await prisma.$connect();
      const connected = await prisma.$queryRaw<{ name: string }[]>`
        SELECT current_database() AS name
      `;

      if (connected[0]?.name !== 'cocos_legacy_test') {
        throw new Error(
          `Refusing to use database ${connected[0]?.name ?? 'unknown'}.`,
        );
      }

      const clients = new PrismaClientProvider(prisma);
      const ids = new NodeUuidGenerator();
      const instruments = new PrismaInstrumentQueries(clients);
      const unitOfWork = new PrismaUnitOfWork(prisma);
      const accountLock = new PrismaAccountLock(clients);
      const orders = new PrismaOrderRepository(clients);
      const accounts = new PrismaAccountRepository(clients);
      const idempotency = new PrismaIdempotencyStore(clients, ids);
      portfolio = new GetPortfolio(
        new PrismaOrdersPortfolioData(clients),
        instruments,
      );
      cash = new SubmitCashMovement(
        idempotency,
        instruments,
        unitOfWork,
        accountLock,
        orders,
        ids,
        accounts,
      );
      trades = new SubmitTradeOrder(
        idempotency,
        instruments,
        unitOfWork,
        accountLock,
        orders,
        ids,
        accounts,
      );
    });

    afterAll(async () => {
      if (!prisma) {
        return;
      }

      if (ownedAccounts.length > 0) {
        await prisma.accountReservedPosition.deleteMany({
          where: { accountId: { in: ownedAccounts } },
        });
        await prisma.order.deleteMany({
          where: { accountId: { in: ownedAccounts } },
        });
        await prisma.account.deleteMany({
          where: { id: { in: ownedAccounts } },
        });
      }

      if (ownedUsers.length > 0) {
        await prisma.idempotencyRecord.deleteMany({
          where: { userId: { in: ownedUsers } },
        });
        await prisma.user.deleteMany({ where: { id: { in: ownedUsers } } });
      }

      if (ownedQuotes.length > 0) {
        await prisma.marketData.deleteMany({
          where: { id: { in: ownedQuotes } },
        });
      }

      if (ownedInstruments.length > 0) {
        await prisma.instrument.deleteMany({
          where: { id: { in: ownedInstruments } },
        });
      }

      await prisma.$disconnect();
    });

    it('adds a filled deposit, ignores a rejected withdrawal, and does not spend reserved cash', async () => {
      const owned = await createAccount();
      const before = await read(owned.userId);

      expect(sameMoney(before.settledCash, '0')).toBe(true);
      expect(sameMoney(before.availableCash, '0')).toBe(true);
      expect(sameMoney(before.reservedCash, '0')).toBe(true);
      expect(sameMoney(before.totalValue ?? '', '0')).toBe(true);
      expect(before.positions).toEqual([]);

      const deposit = await cash.execute(
        movement(owned, 'CASH_IN', '1500.50', 'deposit'),
      );
      const deposited = await read(owned.userId);

      expect(deposit.status).toBe('FILLED');
      expect(movedBy(before, deposited, '1500.50')).toBe(true);
      expect(sameMoney(deposited.reservedCash, '0')).toBe(true);
      expect(deposited.positions).toEqual([]);
      expect(await cashCount(owned.accountId, 'CASH_IN')).toBe(1);

      const replay = await cash.execute(
        movement(owned, 'CASH_IN', '1500.50', 'deposit'),
      );
      const afterReplay = await read(owned.userId);

      expect(replay).toEqual(deposit);
      expect(samePortfolio(afterReplay, deposited)).toBe(true);
      expect(await cashCount(owned.accountId, 'CASH_IN')).toBe(1);

      await trades.execute({
        userId: userId(owned.userId),
        instrumentId: instrumentId(owned.instrumentId),
        side: 'BUY',
        type: 'LIMIT',
        limitPrice: UnitPrice.parse('100'),
        idempotencyKey: 'reserve-cash',
        sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(10n) },
      });
      const reserved = await read(owned.userId);

      expect(sameMoney(reserved.settledCash, '1500.50')).toBe(true);
      expect(sameMoney(reserved.reservedCash, '1000')).toBe(true);
      expect(sameMoney(reserved.availableCash, '500.50')).toBe(true);
      expect(sameMoney(reserved.totalValue ?? '', '1500.50')).toBe(true);
      expect(reserved.positions).toEqual([]);

      const rejected = await cash.execute(
        movement(owned, 'CASH_OUT', '600.00', 'too-much'),
      );
      const afterRejection = await read(owned.userId);

      expect(rejected).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'INSUFFICIENT_CASH',
      });
      expect(samePortfolio(afterRejection, reserved)).toBe(true);

      const withdrawal = await cash.execute(
        movement(owned, 'CASH_OUT', '500.50', 'withdraw-available'),
      );
      const afterWithdrawal = await read(owned.userId);

      expect(withdrawal.status).toBe('FILLED');
      expect(movedBy(reserved, afterWithdrawal, '-500.50')).toBe(true);
      expect(sameMoney(afterWithdrawal.reservedCash, '1000')).toBe(true);
      expect(afterWithdrawal.positions).toEqual([]);

      await cash.execute(
        movement(owned, 'CASH_OUT', '500.50', 'withdraw-available'),
      );
      const afterWithdrawalReplay = await read(owned.userId);

      expect(samePortfolio(afterWithdrawalReplay, afterWithdrawal)).toBe(true);
      expect(await cashCount(owned.accountId, 'CASH_OUT')).toBe(2);

      const beforeTopUp = afterWithdrawalReplay;
      await cash.execute(movement(owned, 'CASH_IN', '200.00', 'top-up'));
      const toppedUp = await read(owned.userId);

      expect(movedBy(beforeTopUp, toppedUp, '200.00')).toBe(true);
      expect(sameMoney(toppedUp.reservedCash, '1000')).toBe(true);
      expect(toppedUp.positions).toEqual([]);
    });

    it('changes settled cash without moving share reserves or showing cash as a position', async () => {
      const owned = await createAccount();
      await cash.execute(movement(owned, 'CASH_IN', '10000.00', 'fund'));
      await trades.execute({
        userId: userId(owned.userId),
        instrumentId: instrumentId(owned.instrumentId),
        side: 'BUY',
        type: 'MARKET',
        idempotencyKey: 'buy-shares',
        sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(10n) },
      });
      await trades.execute({
        userId: userId(owned.userId),
        instrumentId: instrumentId(owned.instrumentId),
        side: 'SELL',
        type: 'LIMIT',
        limitPrice: UnitPrice.parse('100'),
        idempotencyKey: 'reserve-shares',
        sizing: { kind: 'QUANTITY', quantity: ShareQuantity.of(4n) },
      });
      const reserved = await read(owned.userId);
      const shares = holding(reserved, owned.ticker);

      expect(shares).toMatchObject({
        quantity: '10',
        reservedQuantity: '4',
        availableQuantity: '6',
      });
      expect(reserved.positions).toHaveLength(1);
      expect(sameMoney(reserved.settledCash, '9000')).toBe(true);
      expect(sameMoney(reserved.reservedCash, '0')).toBe(true);

      await cash.execute(movement(owned, 'CASH_IN', '100.00', 'extra'));
      const deposited = await read(owned.userId);

      expect(movedBy(reserved, deposited, '100.00')).toBe(true);
      expect(holding(deposited, owned.ticker)).toMatchObject({
        quantity: '10',
        reservedQuantity: '4',
        availableQuantity: '6',
      });
      expect(
        deposited.positions.some((position) => position.ticker === 'ARS'),
      ).toBe(false);

      const beforeRejection = deposited;
      const rejected = await cash.execute(
        movement(owned, 'CASH_OUT', '10000.00', 'over-available'),
      );
      const afterRejection = await read(owned.userId);

      expect(rejected.status).toBe('REJECTED');
      expect(samePortfolio(afterRejection, beforeRejection)).toBe(true);
      expect(holding(afterRejection, owned.ticker)?.reservedQuantity).toBe('4');

      await cash.execute(
        movement(owned, 'CASH_OUT', '100.00', 'withdraw-extra'),
      );
      const withdrawn = await read(owned.userId);

      expect(movedBy(beforeRejection, withdrawn, '-100.00')).toBe(true);
      expect(holding(withdrawn, owned.ticker)).toMatchObject({
        quantity: '10',
        reservedQuantity: '4',
        availableQuantity: '6',
      });
      expect(sameMoney(withdrawn.reservedCash, '0')).toBe(true);
      expect(withdrawn.positions).toHaveLength(1);

      await cash.execute(
        movement(owned, 'CASH_OUT', '100.00', 'withdraw-extra'),
      );

      expect(samePortfolio(await read(owned.userId), withdrawn)).toBe(true);
      expect(await cashCount(owned.accountId, 'CASH_OUT')).toBe(2);
    });

    async function read(owner: string): Promise<Portfolio> {
      return portfolio.execute(uuid(owner));
    }

    async function cashCount(
      accountId: string,
      side: 'CASH_IN' | 'CASH_OUT',
    ): Promise<number> {
      return prisma.order.count({ where: { accountId, side } });
    }

    async function createAccount(): Promise<{
      userId: string;
      accountId: string;
      instrumentId: string;
      ticker: string;
    }> {
      const owner = randomUUID();
      const ownedAccount = randomUUID();
      const stock = randomUUID();
      const quote = randomUUID();
      const ticker = `K${owner.replaceAll('-', '').slice(0, 8)}`.toUpperCase();
      ownedUsers.push(owner);
      ownedAccounts.push(ownedAccount);
      ownedInstruments.push(stock);
      ownedQuotes.push(quote);

      await prisma.user.create({
        data: {
          id: owner,
          email: `cash-portfolio-${owner}@test.local`,
          account: {
            create: {
              id: ownedAccount,
              accountNumber: `cash-portfolio-${ownedAccount}`,
            },
          },
        },
      });
      await prisma.instrument.create({
        data: {
          id: stock,
          ticker,
          name: 'Cash portfolio instrument',
          type: 'ACCIONES',
        },
      });
      await prisma.marketData.create({
        data: {
          id: quote,
          instrumentId: stock,
          high: '120.00',
          low: '80.00',
          open: '100.00',
          close: '100.00',
          previousClose: '90.00',
          observedAt: new Date(),
        },
      });

      return {
        userId: owner,
        accountId: ownedAccount,
        instrumentId: stock,
        ticker,
      };
    }
  },
);

function movement(
  owned: { userId: string },
  side: 'CASH_IN' | 'CASH_OUT',
  amount: string,
  idempotencyKey: string,
) {
  return {
    userId: userId(owned.userId),
    side,
    amount,
    idempotencyKey,
  };
}

function movedBy(before: Portfolio, after: Portfolio, amount: string): boolean {
  const delta = Money.parse(amount);

  return (
    Money.fromCalculation(after.settledCash).equals(
      Money.fromCalculation(before.settledCash).add(delta),
    ) &&
    Money.fromCalculation(after.availableCash).equals(
      Money.fromCalculation(before.availableCash).add(delta),
    ) &&
    Money.fromCalculation(after.totalValue ?? '').equals(
      Money.fromCalculation(before.totalValue ?? '').add(delta),
    )
  );
}

function samePortfolio(actual: Portfolio, expected: Portfolio): boolean {
  return (
    Money.fromCalculation(actual.settledCash).equals(
      Money.fromCalculation(expected.settledCash),
    ) &&
    Money.fromCalculation(actual.reservedCash).equals(
      Money.fromCalculation(expected.reservedCash),
    ) &&
    Money.fromCalculation(actual.availableCash).equals(
      Money.fromCalculation(expected.availableCash),
    ) &&
    Money.fromCalculation(actual.totalValue ?? '').equals(
      Money.fromCalculation(expected.totalValue ?? ''),
    ) &&
    JSON.stringify(actual.positions) === JSON.stringify(expected.positions)
  );
}

function holding(portfolio: Portfolio, ticker: string) {
  return portfolio.positions.find((position) => position.ticker === ticker);
}

function sameMoney(actual: string, expected: string): boolean {
  return Money.fromCalculation(actual).equals(Money.parse(expected));
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
