import {
  INIT_MIGRATION,
  LEGACY_REFERENCE_DATABASE,
  LEGACY_TEST_DATABASE,
  assertRehearsalHistory,
  inspectMigrationTable,
  localUrl,
  prismaMigrationNames,
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

if (!(await hasReservationSchema(testUrl))) {
  await compareSchema(testUrl, referenceUrl, [INIT_MIGRATION]);
}

await baseline(testUrl);
await deployPendingMigrations(testUrl);
await verifyReservationBackfill(testUrl);
await compareSchema(testUrl, referenceUrl, prismaMigrationNames());

console.log(
  'Legacy rehearsal applied the pending migrations and the reserve backfill. Running integration tests.',
);

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

async function hasReservationSchema(connectionString) {
  return withClient(connectionString, LEGACY_TEST_DATABASE, async (client) => {
    const column = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'accounts'
        AND column_name = 'reserved_cash'
    `);

    return column.rowCount > 0;
  });
}

async function compareSchema(upgradedUrl, reference, migrations) {
  await dropDatabase(maintenanceUrl, LEGACY_REFERENCE_DATABASE);
  await ensureDatabase(maintenanceUrl, LEGACY_REFERENCE_DATABASE);
  await withClient(reference, LEGACY_REFERENCE_DATABASE, async (client) => {
    for (const migration of migrations) {
      await runSqlFile(
        client,
        `prisma/migrations/${migration}/migration.sql`,
      );
    }
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
      `The rehearsed schema does not match ${migrations.join(', ')}.`,
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
  const history = assertRehearsalHistory(state);

  if (history === 'recorded') {
    console.log('Prisma migration history is already recorded.');
    return;
  }

  await run('npx', ['prisma', 'migrate', 'resolve', '--applied', INIT_MIGRATION], {
    ...process.env,
    DATABASE_URL: connectionString,
  });
}

async function deployPendingMigrations(connectionString) {
  const url = new URL(connectionString);

  if (url.pathname !== `/${LEGACY_TEST_DATABASE}`) {
    throw new Error(`Refusing to migrate database ${url.pathname}.`);
  }

  await run('npx', ['prisma', 'migrate', 'deploy'], {
    ...process.env,
    DATABASE_URL: connectionString,
  });
}

async function verifyReservationBackfill(connectionString) {
  await withClient(connectionString, LEGACY_TEST_DATABASE, async (client) => {
    const reserved = await client.query(`
      SELECT users.email,
             accounts.reserved_cash = 125500 AS emiliano_cash,
             accounts.reserved_cash = 0 AS empty_cash,
             COUNT(account_reserved_positions.account_id) AS positions
      FROM users
      JOIN accounts ON accounts.user_id = users.id
      LEFT JOIN account_reserved_positions
        ON account_reserved_positions.account_id = accounts.id
      WHERE users.email IN (
        'emiliano@test.com',
        'jose@test.com',
        'francisco@test.com',
        'juan@test.com'
      )
      GROUP BY users.email, accounts.reserved_cash
      ORDER BY users.email
    `);
    const invariant = await client.query(`
      SELECT COUNT(*)::int AS mismatches
      FROM accounts
      WHERE accounts.reserved_cash IS DISTINCT FROM COALESCE((
        SELECT SUM(orders.size * orders.price)
        FROM orders
        WHERE orders.account_id = accounts.id
          AND orders.side = 'BUY'
          AND orders.type = 'LIMIT'
          AND orders.status = 'NEW'
      ), 0)
    `);
    const shareInvariant = await client.query(`
      SELECT COUNT(*)::int AS mismatches
      FROM (
        SELECT account_id, instrument_id, SUM(size) AS quantity
        FROM orders
        WHERE side = 'SELL' AND type = 'LIMIT' AND status = 'NEW'
        GROUP BY account_id, instrument_id
        HAVING SUM(size) > 0
      ) AS expected
      FULL OUTER JOIN account_reserved_positions AS stored
        ON stored.account_id = expected.account_id
       AND stored.instrument_id = expected.instrument_id
      WHERE stored.quantity IS DISTINCT FROM expected.quantity
         OR stored.account_id IS NULL
         OR expected.account_id IS NULL
    `);

    const byEmail = new Map(reserved.rows.map((row) => [row.email, row]));
    const emiliano = byEmail.get('emiliano@test.com');

    if (
      reserved.rowCount !== 4 ||
      emiliano?.emiliano_cash !== true ||
      Number(emiliano.positions) !== 0
    ) {
      throw new Error('Emiliano reserve backfill does not match the approved orders.');
    }

    for (const email of ['francisco@test.com', 'jose@test.com', 'juan@test.com']) {
      const row = byEmail.get(email);

      if (row?.empty_cash !== true || Number(row.positions) !== 0) {
        throw new Error(`${email} does not have empty reserves.`);
      }
    }

    if (
      Number(invariant.rows[0].mismatches) !== 0 ||
      Number(shareInvariant.rows[0].mismatches) !== 0
    ) {
      throw new Error('Persisted reserves do not match LIMIT NEW orders.');
    }
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
