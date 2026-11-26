import { Module } from '@nestjs/common';
import { UnitOfWork } from '../../application/unit-of-work.js';
import { PrismaClientProvider } from './prisma-client.provider.js';
import { PrismaService } from './prisma.service.js';
import { PrismaUnitOfWork } from './prisma-unit-of-work.js';

@Module({
  providers: [
    PrismaService,
    PrismaClientProvider,
    PrismaUnitOfWork,
    {
      provide: UnitOfWork,
      useExisting: PrismaUnitOfWork,
    },
  ],
  exports: [PrismaClientProvider, UnitOfWork],
})
export class PrismaModule {}
