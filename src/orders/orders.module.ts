import { Module } from '@nestjs/common';

import { SharedModule } from '#shared/shared.module.js';

import { AccountLock } from './application/ports/account-lock.js';
import { PrismaAccountLock } from './infrastructure/prisma/prisma-account-lock.js';

@Module({
  imports: [SharedModule],
  providers: [
    PrismaAccountLock,
    { provide: AccountLock, useExisting: PrismaAccountLock },
  ],
  exports: [AccountLock],
})
export class OrdersModule {}
