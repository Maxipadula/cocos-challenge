import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { rememberDocumentationApp } from './docs/serve-docs.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  rememberDocumentationApp(app);
  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
