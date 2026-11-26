import 'dotenv/config';

import pg from 'pg';

import { assertLocalHost, run } from './legacy-common.mjs';

const { Client } = pg;

try {
  await prepareLocalDatabase();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function prepareLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  assertLocalHost(new URL(databaseUrl).hostname);

  await run('docker', ['compose', 'up', '-d', '--wait']);
  await run('npm', ['run', 'db:migrate'], process.env);

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();

  try {
    const result = await client.query(
      'SELECT count(*)::int AS count FROM users',
    );
    const count = result.rows[0].count;

    if (count > 0) {
      console.log(
        `Local database already has ${count} users. Skipping the development seed.`,
      );
      return;
    }

    console.log('Local database is empty. Loading the development seed.');
    await run('npm', ['run', 'db:seed'], process.env);
  } finally {
    await client.end();
  }
}
