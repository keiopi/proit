import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db/db';
import { HttpError, notFound } from './errors';

export const SESSION_COOKIE = 'proit_session';
const SESSION_HOURS = 12;

export type Role = 'customer' | 'manager' | 'admin';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  title: string;
  role: Role;
  portfolioMode: 'own' | 'all';
}

/** The customers the session may see. Every data access function requires one. */
export interface Scope {
  readonly userId: string;
  readonly role: Role;
  readonly mode: 'own' | 'all';
  readonly customerIds: readonly string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: SessionUser;
      scope: Scope;
    }
  }
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expires]);
  return token;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function resolveScope(db: Db, user: Pick<SessionUser, 'id' | 'role' | 'portfolioMode'>): Promise<Scope> {
  const all = user.role === 'admin' && user.portfolioMode === 'all';
  const rows = all
    ? await db.query<{ id: string }>('SELECT id FROM customers ORDER BY name')
    : await db.query<{ id: string }>(
        `SELECT c.id FROM customer_assignments a JOIN customers c ON c.id = a.customer_id WHERE a.user_id = $1 ORDER BY c.name`,
        [user.id],
      );
  return { userId: user.id, role: user.role, mode: all ? 'all' : 'own', customerIds: rows.map((r) => r.id) };
}

export function requireSession(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) throw new HttpError(401, 'Please sign in');
    const rows = await db.query(
      `SELECT u.id, u.name, u.email, u.title, u.role, s.portfolio_mode
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    if (!rows[0]) throw new HttpError(401, 'Your session has ended. Please sign in again');
    const r = rows[0];
    req.user = { id: r.id, name: r.name, email: r.email, title: r.title, role: r.role, portfolioMode: r.portfolio_mode };
    req.scope = await resolveScope(db, req.user);
    next();
  };
}

export async function setPortfolioMode(db: Db, req: Request, mode: 'own' | 'all'): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE)!;
  await db.query('UPDATE sessions SET portfolio_mode = $1 WHERE token_hash = $2', [mode, hashToken(token)]);
}

/** Returns the customers to query. A requested customer can only narrow the scope. */
export function narrowCustomers(scope: Scope, customerId?: string | null): string[] {
  if (!customerId) return [...scope.customerIds];
  return scope.customerIds.includes(customerId) ? [customerId] : [];
}

export function assertInScope(scope: Scope, customerId: string): void {
  if (!scope.customerIds.includes(customerId)) throw notFound();
}

export async function getRiskAuthority(db: Db, userId: string, customerId: string): Promise<'owner' | 'delegate' | null> {
  const rows = await db.query<{ kind: 'owner' | 'delegate' }>('SELECT kind FROM risk_approvers WHERE user_id = $1 AND customer_id = $2', [userId, customerId]);
  return rows[0]?.kind ?? null;
}

export async function writeAudit(
  db: Db,
  user: Pick<SessionUser, 'id' | 'name' | 'role'>,
  customerId: string,
  entity: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (id, actor_id, actor_name, actor_role, customer_id, entity, entity_id, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [crypto.randomUUID(), user.id, user.name, user.role, customerId, entity, entityId, action, JSON.stringify(detail)],
  );
}
