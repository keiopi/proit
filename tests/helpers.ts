import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import request from 'supertest';
import type { Db } from '../src/server/db/db';
import { runMigrations } from '../src/server/db/db';
import { seed } from '../src/server/db/seed';
import { createApp } from '../src/server/app';

export function createPgliteDb(): Db {
  const pg = new PGlite();
  const wrap = (q: { query: PGlite['query']; exec: PGlite['exec'] }): Db => {
    const db: Db = {
      async query(sql: string, params: unknown[] = []) {
        return (await q.query(sql, params as any[])).rows as any[];
      },
      async exec(sql: string) {
        await q.exec(sql);
      },
      tx: (fn: any) => fn(db),
      close: async () => {},
    };
    return db;
  };
  const root = wrap(pg);
  return {
    ...root,
    tx: (fn) => pg.transaction((t) => fn(wrap(t as any))) as Promise<any>,
    close: () => pg.close(),
  };
}

export async function setup(now?: Date) {
  const db = createPgliteDb();
  await runMigrations(db, path.resolve(__dirname, '../migrations'));
  await seed(db, now);
  const app = createApp(db);
  const login = async (userId: string) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ userId });
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    return agent;
  };
  return { db, app, login };
}

export const CUSTOMER = 'u-nora';
export const RISK_OWNER = 'u-nina';
export const DELEGATE = 'u-nate';
export const IRONVALE_CUSTOMER = 'u-ivan';
export const IRONVALE_OWNER = 'u-isla';
export const CEDAR_CUSTOMER = 'u-cara';
export const MANAGER_A = 'u-maya';
export const MANAGER_B = 'u-marek';
export const ADMIN = 'u-alex';
