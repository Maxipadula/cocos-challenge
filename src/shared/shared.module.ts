import { Module } from '@nestjs/common';
import { UuidGenerator } from './application/uuid-generator.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { NodeUuidGenerator } from './infrastructure/uuid/node-uuid-generator.js';

@Module({
  imports: [PrismaModule],
  providers: [
    NodeUuidGenerator,
    { provide: UuidGenerator, useExisting: NodeUuidGenerator },
  ],
  exports: [PrismaModule, UuidGenerator],
})
export class SharedModule {}
