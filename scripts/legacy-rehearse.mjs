import {
  INIT_MIGRATION,
  LEGACY_REFERENCE_DATABASE,
  LEGACY_TEST_DATABASE,
  assertBaselineIsSafe,
  inspectMigrationTable,
  localUrl,
  publicSchemaSignature,
  run,
  runSqlFile,
  withClient,
} from './legacy-common.mjs';
import pg from 'pg';

const { Client } = pg;

const maintenanceUrl = localUrl('postgres');
const testUrl = localUrl(LEGACY_TEST_DATABASE);
const referenceUrl = localUrl(LEGACY_REFERENCE_DATABASE);

await ensureDatabase(maintenanceUrl, LEGACY_TEST_DATABASE);
await prepareLegacyTestDatabase(testUrl);
await upgradeIfNeeded(testUrl);
await verifyFixtureData(testUrl);
await compareWithInitMigration(testUrl, referenceUrl);
await baseline(testUrl);

console.log('Legacy rehearsal matches the init migration. Running integration tests.');

await run('npm', ['run', 'test:integration'], {
  ...process.env,
  DATABASE_URL: testUrl,
  SEED_DEV: '1',
});

async function ensureDatabase(adminUrl, database) {
  if (database !== LEGACY_TEST_DATABASE && database !== LEGACY_REFERENCE_DATABASE) {
    throw new Error(`Refusing to create database ${database}.`);
  }

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    const current = await admin.query('SELECT current_database() AS name');

    if (current.rows[0].name !== 'postgres') {
      throw new Error(`Maintenance connection is ${current.rows[0].name}.`);
    }

    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );

    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${database}`);
    }
  } finally {
    await admin.end();
  }
}

async function prepareLegacyTestDatabase(connectionString) {
  await withClient(connectionString, LEGACY_TEST_DATABASE, async (client) => {
    const state = await databaseState(client);

    if (state === 'empty') {
      await client.query('BEGIN');

      try {
        await runSqlFile(client, 'prisma/fixtures/real-database.sql');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      return;
    }

    if (state === 'legacy' || state === 'current') {
      return;
    }

    throw new Error(`cocos_legacy_test is in an unexpected state: ${state}.`);
  });
}

async function upgradeIfNeeded(connectionString) {
  await withClient(connectionString, LEGACY_TEST_DATABASE, async (client) => {
    if ((await databaseState(client)) === 'current') {
      console.log('cocos_legacy_test already has the current schema.');
      return;
    }

    await runSqlFile(client, 'prisma/legacy-upgrade/001_to_current_schema.sql');
  });
}

async function verifyFixtureData(connectionString) {
  await withClient(connectionString, LEGACY_TEST_DATABASE, async (client) => {
    const totals = await client.query(`
      SELECT
        COALESCE(SUM(
          CASE
            WHEN orders.side = 'CASH_IN' AND orders.status = 'FILLED' THEN orders.size
            WHEN orders.side = 'CASH_OUT' AND orders.status = 'FILLED' THEN -orders.size
            WHEN orders.side = 'BUY' AND orders.status = 'FILLED' THEN -orders.size * orders.price
            WHEN orders.side = 'SELL' AND orders.status = 'FILLED' THEN orders.size * orders.price
            ELSE 0
          END
        ), 0) = 783800 AS settled,
        COALESCE(SUM(
          CASE
            WHEN orders.side = 'BUY' AND orders.type = 'LIMIT' AND orders.status = 'NEW'
              THEN orders.size * orders.price
            ELSE 0
          END
        ), 0) = 125500 AS committed
      FROM orders
      JOIN accounts ON accounts.id = orders.account_id
      JOIN users ON users.id = accounts.user_id
      WHERE users.email = 'emiliano@test.com'
    `);
    const positions = await client.query(`
      SELECT instruments.ticker,
             SUM(
               CASE
                 WHEN orders.side = 'BUY' AND orders.status = 'FILLED' THEN orders.size
                 WHEN orders.side = 'SELL' AND orders.status = 'FILLED' THEN -orders.size
                 ELSE 0
               END
             )::bigint AS quantity
      FROM orders
      JOIN accounts ON accounts.id = orders.account_id
      JOIN users ON users.id = accounts.user_id
      JOIN instruments ON instruments.id = orders.instrument_id
      WHERE users.email = 'emiliano@test.com'
      GROUP BY instruments.ticker
      HAVING SUM(
        CASE
          WHEN orders.side = 'BUY' AND orders.status = 'FILLED' THEN orders.size
          WHEN orders.side = 'SELL' AND orders.status = 'FILLED' THEN -orders.size
          ELSE 0
        END
      ) <> 0
      ORDER BY instruments.ticker
    `);
    const rounded = await client.query(`
      SELECT previous_close = 1047.17 AS matches
      FROM market_data
      JOIN instruments ON instruments.id = market_data.instrument_id
      WHERE instruments.ticker = 'BBAR'
        AND observed_at = '2023-07-14T00:00:00.000Z'
    `);

    if (totals.rows[0].settled !== true || totals.rows[0].committed !== true) {
      throw new Error('Emiliano cash totals do not match the approved portfolio.');
    }

    assertPositions(positions.rows, [
      ['BMA', '-30'],
      ['METR', '500'],
      ['PAMP', '40'],
    ]);

    if (rounded.rows[0]?.matches !== true) {
      throw new Error('BBAR previous close was not stored as 1047.17.');
    }
  });
}

async function compareWithInitMigration(upgradedUrl, reference) {
  await dropDatabase(maintenanceUrl, LEGACY_REFERENCE_DATABASE);
  await ensureDatabase(maintenanceUrl, LEGACY_REFERENCE_DATABASE);
  await withClient(reference, LEGACY_REFERENCE_DATABASE, async (client) => {
    await runSqlFile(client, 'prisma/migrations/20261126054100_init/migration.sql');
  });

  const upgraded = await withClient(
    upgradedUrl,
    LEGACY_TEST_DATABASE,
    publicSchemaSignature,
  );
  const migrated = await withClient(
    reference,
    LEGACY_REFERENCE_DATABASE,
    publicSchemaSignature,
  );

  if (upgraded !== migrated) {
    throw new Error(
      'The upgraded schema does not match prisma/migrations/20261126054100_init.',
    );
  }

  await dropDatabase(maintenanceUrl, LEGACY_REFERENCE_DATABASE);
}

async function baseline(connectionString) {
  const state = await withClient(
    connectionString,
    LEGACY_TEST_DATABASE,
    inspectMigrationTable,
  );
  const baseline = assertBaselineIsSafe(state);

  if (baseline === 'applied') {
    console.log(`${INIT_MIGRATION} is already recorded.`);
    return;
  }

  await run('npx', ['prisma', 'migrate', 'resolve', '--applied', INIT_MIGRATION], {
    ...process.env,
    DATABASE_URL: connectionString,
  });
}

async function dropDatabase(adminUrl, database) {
  if (database !== LEGACY_REFERENCE_DATABASE) {
    throw new Error(`Refusing to drop database ${database}.`);
  }

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [database],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
  } finally {
    await admin.end();
  }
}

async function databaseState(client) {
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `);
  const names = new Set(tables.rows.map((row) => row.table_name));

  if (names.size === 0) {
    return 'empty';
  }

  const legacy =
    names.has('users') &&
    names.has('instruments') &&
    names.has('orders') &&
    names.has('marketdata');
  const current = names.has('accounts') && names.has('market_data');

  if (legacy && !current) {
    return 'legacy';
  }

  if (current && !names.has('marketdata')) {
    return 'current';
  }

  return 'mixed';
}

function assertPositions(rows, expected) {
  const actual = rows.map((row) => [row.ticker, String(row.quantity)]);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Positions are ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
    );
  }
}
