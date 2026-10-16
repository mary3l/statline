import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import { lockPglite } from './pgliteLock.js';
import * as schema from './schema.js';

export { schema };

/** Both drivers expose the same query API, so the rest of the app types against node-postgres. */
export type DB = NodePgDatabase<typeof schema>;

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

interface Connection {
  db: DB;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
  label: string;
}

async function connect(): Promise<Connection> {
  if (config.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
    const db = drizzle(pool, { schema, casing: 'snake_case' });
    return {
      db,
      migrate: () => migrate(db, { migrationsFolder }),
      close: () => pool.end(),
      label: 'postgres',
    };
  }

  // Embedded Postgres (WASM) for local development: no install, data kept in PGLITE_DIR.
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  mkdirSync(config.PGLITE_DIR, { recursive: true });
  const unlock = await lockPglite(config.PGLITE_DIR);
  const client = new PGlite(config.PGLITE_DIR);
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return {
    db: db as unknown as DB,
    migrate: () => migrate(db, { migrationsFolder }),
    close: async () => {
      await client.close();
      unlock();
    },
    label: `pglite (${config.PGLITE_DIR})`,
  };
}

let connection: Promise<Connection> | undefined;

export function getConnection(): Promise<Connection> {
  connection ??= connect();
  return connection;
}
