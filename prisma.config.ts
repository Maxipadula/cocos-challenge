import 'dotenv/config';

import { defineConfig } from 'prisma/config';

// Placeholder so `prisma generate` can load this file before a local database
// exists. Migrate commands must use DATABASE_URL from .env, not this fallback.
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://cocos:cocos@localhost:5432/cocos?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
