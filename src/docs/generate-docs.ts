import { mkdirSync, writeFileSync } from 'node:fs';

import { Test } from '@nestjs/testing';

import { PrismaService } from '#shared/infrastructure/prisma/prisma.service.js';

import { AppModule } from '../app.module.js';
import { createOpenApiDocument } from './openapi-document.js';
import {
  localPostmanEnvironment,
  openApiToPostman,
} from './postman-collection.js';

const target = process.argv[2] ?? 'all';

const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(PrismaService)
  .useValue({
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async () => undefined,
  })
  .compile();
const app = moduleRef.createNestApplication({ logger: false });
await app.init();

try {
  const document = createOpenApiDocument(app);

  if (target === 'openapi' || target === 'all') {
    mkdirSync('openapi', { recursive: true });
    writeFileSync(
      'openapi/openapi.json',
      `${JSON.stringify(document, null, 2)}\n`,
    );
  }

  if (target === 'postman' || target === 'all') {
    mkdirSync('postman', { recursive: true });
    const collection = await openApiToPostman(document);
    writeFileSync(
      'postman/cocos-api.postman_collection.json',
      `${JSON.stringify(collection, null, 2)}\n`,
    );
    writeFileSync(
      'postman/cocos-local.postman_environment.json',
      `${JSON.stringify(localPostmanEnvironment(), null, 2)}\n`,
    );
  }
} finally {
  await app.close();
}
