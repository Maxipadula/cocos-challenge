import { Module } from '@nestjs/common';

import { SharedModule } from '#shared/shared.module.js';

import { AccountLock } from './application/ports/account-lock.js';
import { OrderRepository } from './application/ports/order-repository.js';
import { PrismaAccountLock } from './infrastructure/prisma/prisma-account-lock.js';
import { PrismaOrderRepository } from './infrastructure/prisma/prisma-order-repository.js';

@Module({
  imports: [SharedModule],
  providers: [
    PrismaAccountLock,
    { provide: AccountLock, useExisting: PrismaAccountLock },
    PrismaOrderRepository,
    { provide: OrderRepository, useExisting: PrismaOrderRepository },
  ],
  exports: [AccountLock],
})
export class OrdersModule {}
