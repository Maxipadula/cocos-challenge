import { Module } from '@nestjs/common';
import { UnitOfWork } from '../../application/unit-of-work.js';
import { PrismaService } from './prisma.service.js';
import { PrismaUnitOfWork } from './prisma-unit-of-work.js';

@Module({
  providers: [
    PrismaService,
    PrismaUnitOfWork,
    {
      provide: UnitOfWork,
      useExisting: PrismaUnitOfWork,
    },
  ],
  exports: [PrismaService, UnitOfWork],
})
export class PrismaModule {}
