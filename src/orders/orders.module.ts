import { Module } from '@nestjs/common';

import { IdempotencyStore } from '#shared/application/idempotency-store.js';
import { UnitOfWork } from '#shared/application/unit-of-work.js';
import { UuidGenerator } from '#shared/application/uuid-generator.js';
import { SharedModule } from '#shared/shared.module.js';

import { InstrumentQueries } from '#instruments/application/instrument-queries.js';
import { InstrumentsModule } from '#instruments/instruments.module.js';

import { OrdersPortfolioDataProvider } from './application/orders-portfolio-data.js';
import { AccountLock } from './application/ports/account-lock.js';
import { OrderRepository } from './application/ports/order-repository.js';
import { CancelTradeOrder } from './application/use-cases/cancel-trade-order.js';
import { SubmitTradeOrder } from './application/use-cases/submit-trade-order.js';
import { PrismaAccountLock } from './infrastructure/prisma/prisma-account-lock.js';
import { PrismaOrderRepository } from './infrastructure/prisma/prisma-order-repository.js';
import { PrismaOrdersPortfolioData } from './infrastructure/prisma/prisma-orders-portfolio-data.js';
import { OrdersController } from './presentation/orders.controller.js';

@Module({
  imports: [SharedModule, InstrumentsModule],
  controllers: [OrdersController],
  providers: [
    PrismaAccountLock,
    { provide: AccountLock, useExisting: PrismaAccountLock },
    PrismaOrderRepository,
    { provide: OrderRepository, useExisting: PrismaOrderRepository },
    PrismaOrdersPortfolioData,
    {
      provide: OrdersPortfolioDataProvider,
      useExisting: PrismaOrdersPortfolioData,
    },
    {
      provide: SubmitTradeOrder,
      useFactory: (
        idempotency: IdempotencyStore,
        instruments: InstrumentQueries,
        unitOfWork: UnitOfWork,
        accountLock: AccountLock,
        orders: OrderRepository,
        ids: UuidGenerator,
      ) =>
        new SubmitTradeOrder(
          idempotency,
          instruments,
          unitOfWork,
          accountLock,
          orders,
          ids,
        ),
      inject: [
        IdempotencyStore,
        InstrumentQueries,
        UnitOfWork,
        AccountLock,
        OrderRepository,
        UuidGenerator,
      ],
    },
    {
      provide: CancelTradeOrder,
      useFactory: (
        idempotency: IdempotencyStore,
        unitOfWork: UnitOfWork,
        accountLock: AccountLock,
        orders: OrderRepository,
      ) => new CancelTradeOrder(idempotency, unitOfWork, accountLock, orders),
      inject: [IdempotencyStore, UnitOfWork, AccountLock, OrderRepository],
    },
  ],
  exports: [AccountLock, OrdersPortfolioDataProvider],
})
export class OrdersModule {}
