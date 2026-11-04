import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    async query(sql, params = []) {
      return (await pool.query(sql, params as any[])).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      const txDb: Db = {
        async query(sql, params = []) {
          return (await client.query(sql, params as any[])).rows;
        },
        async exec(sql) {
          await client.query(sql);
        },
        tx: (inner) => inner(txDb),
        close: async () => {},
      };
      try {
        await client.query('BEGIN');
        const result = await fn(txDb);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function runMigrations(db: Db, dir = path.resolve(process.cwd(), 'migrations')): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.tx(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    ran.push(file);
  }
  return ran;
}

/** Inserts many rows of one table. Column names come from the first row. */
export async function insertRows(db: Db, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params: unknown[] = [];
    const values = chunk.map((row) => {
      const slots = columns.map((c) => {
        params.push(row[c] ?? null);
        return `$${params.length}`;
      });
      return `(${slots.join(',')})`;
    });
    await db.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')}`, params);
  }
}
