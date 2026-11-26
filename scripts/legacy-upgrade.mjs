import path from 'node:path';

import pg from 'pg';

import {
  INIT_MIGRATION,
  LEGACY_REFERENCE_DATABASE,
  assertBaselineIsSafe,
  assertRemoteTarget,
  inspectMigrationTable,
  localUrl,
  publicSchemaSignature,
  root,
  run,
  runSqlFile,
  withClient,
} from './legacy-common.mjs';

const { Client } = pg;

const target = assertRemoteTarget(process.env.DATABASE_URL ?? '');
const client = new Client({
  connectionString: target.url,
  connectionTimeoutMillis: 10000,
});

await client.connect();

try {
  const current = await client.query('SELECT current_database() AS name');

  if (current.rows[0].name !== target.database) {
    throw new Error(`Connected to ${current.rows[0].name}, expected ${target.database}.`);
  }

  const history = await inspectMigrationTable(client);
  const baseline = assertBaselineIsSafe(history);

  if (baseline === 'applied') {
    throw new Error(
      `${INIT_MIGRATION} is already recorded. Refusing to upgrade this database again.`,
    );
  }

  console.log(`Backup recorded at ${target.backup}.`);
  console.log('Migration history before upgrade:', history);
  await runSqlFile(client, 'prisma/legacy-upgrade/001_to_current_schema.sql');
} finally {
  await client.end();
}

const reference = localUrl(LEGACY_REFERENCE_DATABASE);
const admin = new Client({ connectionString: localUrl('postgres') });
await admin.connect();

try {
  await admin.query(`DROP DATABASE IF EXISTS ${LEGACY_REFERENCE_DATABASE}`);
  await admin.query(`CREATE DATABASE ${LEGACY_REFERENCE_DATABASE}`);
} finally {
  await admin.end();
}

await withClient(reference, LEGACY_REFERENCE_DATABASE, async (referenceClient) => {
  await runSqlFile(
    referenceClient,
    'prisma/migrations/20261126054100_init/migration.sql',
  );
});

const upgradedSignature = await signatureOf(target.url, target.database);
const referenceSignature = await withClient(
  reference,
  LEGACY_REFERENCE_DATABASE,
  publicSchemaSignature,
);
const cleanup = new Client({ connectionString: localUrl('postgres') });
await cleanup.connect();

try {
  await cleanup.query(`DROP DATABASE IF EXISTS ${LEGACY_REFERENCE_DATABASE}`);
} finally {
  await cleanup.end();
}

if (upgradedSignature !== referenceSignature) {
  throw new Error(
    'The remote schema does not match prisma/migrations/20261126054100_init. Baseline was not recorded.',
  );
}

await run('npx', ['prisma', 'migrate', 'resolve', '--applied', INIT_MIGRATION], {
  ...process.env,
  DATABASE_URL: target.url,
});

console.log(`${INIT_MIGRATION} recorded. Future changes belong to Prisma Migrate.`);
console.log(`Upgrade SQL: ${path.join(root, 'prisma/legacy-upgrade/001_to_current_schema.sql')}`);

async function signatureOf(connectionString, database) {
  const remote = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  await remote.connect();

  try {
    const current = await remote.query('SELECT current_database() AS name');

    if (current.rows[0].name !== database) {
      throw new Error(`Connected to ${current.rows[0].name}.`);
    }

    return await publicSchemaSignature(remote);
  } finally {
    await remote.end();
  }
}
