import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Placeholder so `prisma generate` can load this file before a local database
// exists. The application refuses to start when DATABASE_URL is missing.
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://USER:PASSWORD@localhost:5432/cocos?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
