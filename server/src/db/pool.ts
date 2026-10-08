import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../config';

// DATE -> 'YYYY-MM-DD' string (no timezone shifting), NUMERIC -> number, BIGINT (counts) -> number
types.setTypeParser(1082, (v: string) => v);
types.setTypeParser(1700, (v: string) => parseFloat(v));
types.setTypeParser(20, (v: string) => parseInt(v, 10));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow = any>(sql: string, params: any[] = [], db: Db = pool) {
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = any>(sql: string, params: any[] = [], db: Db = pool) {
  const rows = await query<T>(sql, params, db);
  return rows[0] as T | undefined;
}

/** Run fn inside a transaction; rolls back on any error. */
export async function tx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
