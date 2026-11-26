import { Module } from '@nestjs/common';

import { SharedModule } from '#shared/shared.module.js';

import { OrdersPortfolioDataProvider } from './application/orders-portfolio-data.js';
import { AccountLock } from './application/ports/account-lock.js';
import { OrderRepository } from './application/ports/order-repository.js';
import { PrismaAccountLock } from './infrastructure/prisma/prisma-account-lock.js';
import { PrismaOrderRepository } from './infrastructure/prisma/prisma-order-repository.js';
import { PrismaOrdersPortfolioData } from './infrastructure/prisma/prisma-orders-portfolio-data.js';

@Module({
  imports: [SharedModule],
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
  ],
  exports: [AccountLock, OrdersPortfolioDataProvider],
})
export class OrdersModule {}
