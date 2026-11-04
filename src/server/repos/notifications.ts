import crypto from 'node:crypto';
import type { Db } from '../db/db';
import type { Scope } from '../auth';
import { evaluateLicense } from '../../domain/license';
import { evaluateLifecycle } from '../../domain/lifecycle';

type Row = Record<string, any>;

export async function notify(db: Db, userIds: string[], customerId: string, kind: string, title: string, body: string, link: string, dedupeKey: string): Promise<void> {
  for (const userId of new Set(userIds)) {
    await db.query(
      `INSERT INTO notifications (id, user_id, customer_id, kind, title, body, link, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
      [crypto.randomUUID(), userId, customerId, kind, title, body, link, dedupeKey],
    );
  }
}

/** The smallest configured threshold already reached, so one crossing gives one reminder. */
export function reachedThreshold(daysLeft: number, thresholds: number[]): number | null {
  if (daysLeft < 0) return null;
  const reached = thresholds.filter((t) => daysLeft <= t);
  return reached.length ? Math.min(...reached) : null;
}

/** Creates any due reminders. Dedupe keys make this safe to run repeatedly. */
export async function runReminderSweep(db: Db, now = new Date()): Promise<void> {
  const settings = await db.query<Row>('SELECT * FROM reminder_settings');
  const assignments = await db.query<Row>('SELECT user_id, customer_id FROM customer_assignments');
  const usersFor = (customerId: string) => assignments.filter((a) => a.customer_id === customerId).map((a) => a.user_id);
  const daysUntil = (d: Date | string) => Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);

  for (const s of settings) {
    const cid = s.customer_id;
    const risks = await db.query<Row>(`SELECT * FROM risk_acceptances WHERE customer_id = $1 AND status = 'accepted'`, [cid]);
    for (const r of risks) {
      const owners = [r.risk_owner_id, r.approver_id];
      const expiryDays = daysUntil(r.expiry_at);
      const expiryHit = reachedThreshold(expiryDays, s.risk_days);
      if (expiryHit !== null) {
        await notify(db, owners, cid, 'risk_expiry', `Risk acceptance expires in ${expiryDays} days`, `${r.id}: ${r.title}`, `/risk-acceptances?record=${r.id}`, `risk-expiry:${r.id}:${new Date(r.expiry_at).toISOString()}:${expiryHit}`);
      }
      const reviewDays = daysUntil(r.review_at);
      const reviewHit = reachedThreshold(reviewDays, s.risk_days);
      if (reviewHit !== null) {
        await notify(db, owners, cid, 'risk_review_date', `Risk review due in ${reviewDays} days`, `${r.id}: ${r.title}`, `/risk-acceptances?record=${r.id}`, `risk-review-date:${r.id}:${new Date(r.review_at).toISOString()}:${reviewHit}`);
      }
    }

    const lifecycle = await db.query<Row>('SELECT l.*, o.name AS object_name FROM lifecycle_records l JOIN objects o ON o.id = l.object_id WHERE l.customer_id = $1', [cid]);
    for (const l of lifecycle) {
      const evaluation = evaluateLifecycle(l as any, now);
      if (evaluation.days_remaining === null) continue;
      const hit = reachedThreshold(evaluation.days_remaining, s.lifecycle_days);
      if (hit !== null) {
        await notify(db, usersFor(cid), cid, 'lifecycle', `${l.product} ${l.version} support ends in ${evaluation.days_remaining} days`, `Affects ${l.object_name}. Owner: ${l.owner}.`, `/lifecycle?record=${l.id}`, `lifecycle:${l.id}:${evaluation.deciding_deadline}:${hit}`);
      }
    }

    const licenses = await db.query<Row>('SELECT * FROM licenses WHERE customer_id = $1', [cid]);
    for (const l of licenses) {
      const evaluation = evaluateLicense(l as any, now);
      const hit = reachedThreshold(evaluation.days_to_renewal, s.license_days);
      if (hit !== null) {
        await notify(db, usersFor(cid), cid, 'license_renewal', `${l.product} renews in ${evaluation.days_to_renewal} days`, `Contract ${l.contract_ref}. Owner: ${l.owner}.`, `/licenses?record=${l.id}`, `license-renewal:${l.id}:${new Date(l.renewal_at).toISOString()}:${hit}`);
      }
      if (evaluation.state === 'potential_shortfall') {
        await notify(db, usersFor(cid), cid, 'license_shortfall', `Potential shortfall: ${l.product}`, `Measured use exceeds entitlement by ${evaluation.potential_shortfall} ${l.unit}(s). This is not a compliance determination.`, `/licenses?record=${l.id}`, `license-shortfall:${l.id}:${l.entitlement}:${l.consumption}`);
      }
    }
  }
}

export async function listNotifications(db: Db, scope: Scope, limit = 50): Promise<{ rows: Row[]; unread: number }> {
  if (scope.customerIds.length === 0) return { rows: [], unread: 0 };
  const params = [scope.userId, [...scope.customerIds]];
  const rows = await db.query<Row>(
    `SELECT n.id, n.kind, n.title, n.body, n.link, n.created_at, n.read_at, n.customer_id, c.name AS customer_name
     FROM notifications n JOIN customers c ON c.id = n.customer_id
     WHERE n.user_id = $1 AND n.customer_id = ANY($2::text[])
     ORDER BY n.read_at IS NULL DESC, n.created_at DESC LIMIT ${Number(limit)}`,
    params,
  );
  const unread = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND customer_id = ANY($2::text[]) AND read_at IS NULL`, params);
  return { rows, unread: unread[0].n };
}

export async function markRead(db: Db, scope: Scope, id: string | null): Promise<void> {
  if (id) {
    await db.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND customer_id = ANY($3::text[])`, [id, scope.userId, [...scope.customerIds]]);
  } else {
    await db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND customer_id = ANY($2::text[]) AND read_at IS NULL`, [scope.userId, [...scope.customerIds]]);
  }
}
