import { Pool, PoolClient, QueryResultRow, types as pgTypes } from 'pg';
import { PGlite, types as pgliteTypes } from '@electric-sql/pglite';
import { config } from '../config';
import { SCHEMA_SQL } from './schema_sql';

// Check if we should use PGlite (Vercel serverless or USE_PGLITE flag)
export function isPgLite(): boolean {
  return Boolean(process.env.VERCEL || process.env.USE_PGLITE === 'true');
}

// DATE -> 'YYYY-MM-DD' string (no timezone shifting), NUMERIC -> number, BIGINT (counts) -> number
pgTypes.setTypeParser(1082, (v: string) => v);
pgTypes.setTypeParser(1700, (v: string) => parseFloat(v));
pgTypes.setTypeParser(20, (v: string) => parseInt(v, 10));

let pgliteInstance: PGlite | null = null;
let pgliteReadyPromise: Promise<PGlite> | null = null;
let pgliteTxLock = Promise.resolve();

export async function getPgLite(): Promise<PGlite> {
  if (pgliteInstance) return pgliteInstance;
  if (!pgliteReadyPromise) {
    pgliteReadyPromise = (async () => {
      console.log('[db] Initializing PGlite embedded database...');
      const pglite = new PGlite({
        parsers: {
          [pgliteTypes.NUMERIC]: (v: string) => parseFloat(v),
          [pgliteTypes.DATE]: (v: string) => (typeof v === 'string' ? v.slice(0, 10) : v),
        },
      });
      await pglite.exec(SCHEMA_SQL);
      await pglite.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now()); INSERT INTO schema_migrations (name) VALUES ('001_schema.sql') ON CONFLICT DO NOTHING;");
      console.log('[db] PGlite schema created.');
      pgliteInstance = pglite;

      try {
        const { seed } = await import('./seed');
        await seed();
        console.log('[db] PGlite seed data loaded.');
      } catch (err) {
        console.error('[db] Error seeding PGlite:', err);
      }
      return pglite;
    })();
  }
  return pgliteReadyPromise;
}

const pgPool = !isPgLite() ? new Pool({ connectionString: config.databaseUrl, max: 20 }) : null;

class PgLitePoolAdapter {
  async query<T extends QueryResultRow = any>(sql: string, params: any[] = []) {
    const db = await getPgLite();
    if (params.length === 0 && sql.includes(';')) {
      await db.exec(sql);
      return { rows: [], rowCount: 0 } as any;
    }
    return db.query<T>(sql, params);
  }
  async connect(): Promise<PoolClient> {
    const db = await getPgLite();
    return {
      query: (sql: string, params: any[] = []) => {
        if (params.length === 0 && sql.includes(';')) {
          return db.exec(sql).then(() => ({ rows: [], rowCount: 0 } as any));
        }
        return db.query(sql, params);
      },
      release: () => {},
    } as unknown as PoolClient;
  }
  async end() {
    if (pgliteInstance) {
      await pgliteInstance.close();
      pgliteInstance = null;
      pgliteReadyPromise = null;
    }
  }
}

export const pool = (isPgLite() ? new PgLitePoolAdapter() : pgPool!) as unknown as Pool;

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow = any>(sql: string, params: any[] = [], db: Db = pool) {
  if (isPgLite() && (db === (pool as any) || !db)) {
    const pglite = await getPgLite();
    if (params.length === 0 && sql.includes(';')) {
      await pglite.exec(sql);
      return [] as T[];
    }
    const res = await pglite.query<T>(sql, params);
    return res.rows;
  }
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = any>(sql: string, params: any[] = [], db: Db = pool) {
  const rows = await query<T>(sql, params, db);
  return rows[0] as T | undefined;
}

/** Run fn inside a transaction; rolls back on any error. */
export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  if (isPgLite()) {
    const db = await getPgLite();
    return new Promise<T>((resolve, reject) => {
      pgliteTxLock = pgliteTxLock
        .then(async () => {
          const client = {
            query: (sql: string, params: any[] = []) => db.query(sql, params),
            release: () => {},
          } as unknown as PoolClient;
          try {
            await db.query('BEGIN');
            const result = await fn(client);
            await db.query('COMMIT');
            resolve(result);
          } catch (err) {
            await db.query('ROLLBACK');
            reject(err);
          }
        })
        .catch(reject);
    });
  }

  const client = await (pgPool as Pool).connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
