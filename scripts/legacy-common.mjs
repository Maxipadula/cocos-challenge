import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export const INIT_MIGRATION = '20261126054100_init';
export const LEGACY_TEST_DATABASE = 'cocos_legacy_test';
export const LEGACY_REFERENCE_DATABASE = 'cocos_legacy_reference';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function assertLocalHost(hostname) {
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing database host ${hostname}.`);
  }
}

export function localUrl(database) {
  const configured = process.env.DATABASE_URL;
  const url = configured
    ? new URL(configured)
    : new URL('postgresql://cocos:cocos@127.0.0.1:5432/postgres');

  assertLocalHost(url.hostname);
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
}

export async function withClient(connectionString, expectedDatabase, work) {
  const url = new URL(connectionString);
  assertLocalHost(url.hostname);

  const database = url.pathname.replace(/^\//, '');

  if (database !== expectedDatabase) {
    throw new Error(
      `Refusing to use database ${database}. Expected ${expectedDatabase}.`,
    );
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();

  try {
    const current = await client.query('SELECT current_database() AS name');

    if (current.rows[0].name !== expectedDatabase) {
      throw new Error(
        `Connected to ${current.rows[0].name}, expected ${expectedDatabase}.`,
      );
    }

    return await work(client);
  } finally {
    await client.end();
  }
}

export async function runSqlFile(client, relativePath) {
  const sql = readFileSync(path.join(root, relativePath), 'utf8');
  await client.query(sql);
}

export async function publicSchemaSignature(client) {
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable,
           character_maximum_length, numeric_precision, numeric_scale,
           datetime_precision, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name, ordinal_position
  `);
  const constraints = await client.query(`
    SELECT conrelid::regclass::text AS table_name, conname,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND conrelid::regclass::text <> '_prisma_migrations'
    ORDER BY 1, 2
  `);
  const indexes = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
    ORDER BY indexname
  `);

  return JSON.stringify({
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  });
}

export async function inspectMigrationTable(client) {
  const present = await client.query(
    `SELECT to_regclass('public._prisma_migrations') AS name`,
  );

  if (!present.rows[0].name) {
    return [];
  }

  const rows = await client.query(`
    SELECT migration_name, finished_at, rolled_back_at, applied_steps_count, logs
    FROM _prisma_migrations
    ORDER BY started_at
  `);

  return rows.rows;
}

export function prismaMigrationNames() {
  return readdirSync(path.join(root, 'prisma/migrations'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function assertRehearsalHistory(rows) {
  const known = prismaMigrationNames();

  if (rows.length === 0) {
    return 'missing';
  }

  if (rows.length > known.length) {
    throw new Error(
      `Refusing to continue. _prisma_migrations has unexpected rows: ${JSON.stringify(rows)}.`,
    );
  }

  for (const [index, row] of rows.entries()) {
    if (
      row.migration_name !== known[index] ||
      row.finished_at === null ||
      row.rolled_back_at !== null
    ) {
      throw new Error(
        `Refusing to continue. _prisma_migrations contains: ${JSON.stringify(rows)}.`,
      );
    }
  }

  return 'recorded';
}

export function assertBaselineIsSafe(rows) {
  if (rows.length === 0) {
    return 'missing';
  }

  const unexpected = rows.filter(
    (row) =>
      row.migration_name !== INIT_MIGRATION ||
      row.finished_at === null ||
      row.rolled_back_at !== null,
  );

  if (unexpected.length > 0 || rows.length !== 1) {
    throw new Error(
      `Refusing to baseline. _prisma_migrations contains: ${JSON.stringify(rows)}.`,
    );
  }

  return 'applied';
}

export function assertRemoteTarget(connectionString) {
  if (process.env.LEGACY_UPGRADE_REMOTE !== '1') {
    throw new Error(
      'Remote upgrade requires LEGACY_UPGRADE_REMOTE=1. Use db:legacy:rehearse locally.',
    );
  }

  const backup = process.env.LEGACY_UPGRADE_BACKUP;

  if (!backup) {
    throw new Error(
      'Remote upgrade requires LEGACY_UPGRADE_BACKUP to point at an existing dump.',
    );
  }

  const stat = statSync(backup);

  if (!stat.isFile() || stat.size < 1) {
    throw new Error(`Backup file ${backup} is missing or empty.`);
  }

  const url = new URL(connectionString);
  const database = url.pathname.replace(/^\//, '');

  if (LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      'Remote upgrade refuses localhost. Use npm run db:legacy:rehearse.',
    );
  }

  if (
    database === 'cocos' ||
    database === LEGACY_TEST_DATABASE ||
    database === LEGACY_REFERENCE_DATABASE ||
    database === 'postgres'
  ) {
    throw new Error(`Remote upgrade refuses database ${database}.`);
  }

  return { url: connectionString, database, backup };
}

export function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with ${code}.`));
    });
  });
}
