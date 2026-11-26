import { Module } from '@nestjs/common';

import { DocsController } from './serve-docs.js';

@Module({
  controllers: [DocsController],
})
export class DocsModule {}
