import fs from 'fs';
import path from 'path';
import { pool, isPgLite, getPgLite } from './pool';
import { SCHEMA_SQL } from './schema_sql';

const schemaDir = path.resolve(__dirname, '../../../database/schema');

export async function migrate(): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');

  if (isPgLite() || !fs.existsSync(schemaDir)) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE name = '001_schema.sql'");
    if (!done.rowCount) {
      if (isPgLite()) {
        const pglite = await getPgLite();
        await pglite.exec(SCHEMA_SQL);
        await pglite.query("INSERT INTO schema_migrations (name) VALUES ('001_schema.sql')");
        console.log('Applied embedded SCHEMA_SQL on PGlite');
      } else {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(SCHEMA_SQL);
          await client.query("INSERT INTO schema_migrations (name) VALUES ('001_schema.sql')");
          await client.query('COMMIT');
          console.log('Applied embedded SCHEMA_SQL');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      }
    }
    return;
  }

  const files = fs.readdirSync(schemaDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(schemaDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
