import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type { Db } from './db/db';
import { assertInScope, createSession, destroySession, getRiskAuthority, narrowCustomers, readCookie, requireSession, SESSION_COOKIE, setPortfolioMode, writeAudit } from './auth';
import { badRequest, conflict, forbidden, HttpError, notFound } from './errors';
import { filterOptions, getEntity, listEntity, relatedRecords, type ListParams } from './repos/records';
import { buildOverview, drillDown, hardeningSummary, licenseSummary, periodInfo } from './repos/overview';
import { buildSla, loadSlaData, slaHistory } from './repos/sla';
import { applyRiskExpiry, approveRisk, approverOptions, changeRiskScope, createRisk, publishControlVersion, rejectRisk, renewRisk, revokeRisk, submitRisk, updateDraft } from './repos/risk';
import { listNotifications, markRead, runReminderSweep } from './repos/notifications';
import { adapters } from './adapters';
import { resolvePeriod, type PeriodKey } from '../domain/periods';
import { RISK_TRANSITIONS } from '../domain/riskStateMachine';

const adminOnly = (req: Request) => {
  if (req.user.role !== 'admin') throw forbidden('Only a System Administrator can do this');
};

const str = (max = 4000) => z.string().trim().min(1).max(max);
const reasonBody = z.object({ reason: str() });
const riskCreateBody = z.object({
  controlResultId: str(), objectIds: z.array(z.string()).optional(), justification: z.string().max(4000), residualRisk: z.string().max(200),
  compensatingControls: z.string().max(4000), riskOwnerId: str(), approverId: str(), expiryAt: str(), reviewAt: str(),
});
const riskPatchBody = z.object({
  justification: z.string().max(4000), residualRisk: z.string().max(200), compensatingControls: z.string().max(4000),
  riskOwnerId: str(), approverId: str(), expiryAt: str(), reviewAt: str(),
}).partial();
const lifecyclePatch = z.object({ owner: str(200), plan: z.string().max(4000) }).partial();
const count = z.number().int().min(0).max(100_000_000);
const licensePatch = z.object({
  owner: str(200), entitlement: count, assigned: count.nullable(), consumption: count.nullable(),
  completeness: z.number().int().min(0).max(100).nullable(), renewal_at: str(40), valid_from: str(40), contract_ref: str(100),
}).partial();
const daysList = z.array(z.number().int().min(1).max(1095)).min(1).max(6);
const reminderBody = z.object({ risk_days: daysList, lifecycle_days: daysList, license_days: daysList }).partial();
const weightBody = z.object({ weight: z.number().positive().max(1000), included: z.boolean() }).partial();
const slaCustomerBody = z.object({ exclude_planned_maintenance: z.boolean() });

export function createApp(db: Db): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));

  // State-changing requests must be JSON, which together with SameSite cookies blocks cross-site form posts.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      throw new HttpError(415, 'Requests must use application/json');
    }
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.get('/api/auth/accounts', async (_req, res) => {
    const users = await db.query(`SELECT id, name, title, role FROM users ORDER BY CASE role WHEN 'customer' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, name`);
    const assignments = await db.query(`SELECT a.user_id, c.name FROM customer_assignments a JOIN customers c ON c.id = a.customer_id ORDER BY c.name`);
    const approvers = await db.query(`SELECT r.user_id, r.kind, c.name FROM risk_approvers r JOIN customers c ON c.id = r.customer_id`);
    res.json(users.map((u) => ({
      ...u,
      scope: assignments.filter((a) => a.user_id === u.id).map((a) => a.name),
      canSwitchToAll: u.role === 'admin',
      riskApproval: approvers.filter((a) => a.user_id === u.id).map((a) => ({ customer: a.name, kind: a.kind })),
    })));
  });

  app.post('/api/auth/login', async (req, res) => {
    const { userId } = z.object({ userId: str(100) }).parse(req.body);
    const rows = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw badRequest('Unknown demo account');
    const token = await createSession(db, userId);
    const secure = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_ENVIRONMENT_NAME;
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 12 * 3_600_000 });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Everything below this line requires a session.
  app.use('/api', requireSession(db));

  const sendMe = async (req: Request, res: Response) => {
    const authority = await db.query(`SELECT customer_id, kind FROM risk_approvers WHERE user_id = $1 AND customer_id = ANY($2::text[])`, [req.user.id, [...req.scope.customerIds]]);
    const options = await filterOptions(db, req.scope);
    res.json({ user: req.user, mode: req.scope.mode, canSwitchPortfolio: req.user.role === 'admin', customers: options.customers, riskAuthority: authority });
  };

  app.get('/api/me', sendMe);

  app.post('/api/me/portfolio-mode', async (req, res) => {
    const { mode } = z.object({ mode: z.enum(['own', 'all']) }).parse(req.body);
    adminOnly(req);
    await setPortfolioMode(db, req, mode);
    req.user.portfolioMode = mode;
    res.json({ mode });
  });

  app.get('/api/me/preferences', async (req, res) => {
    const rows = await db.query('SELECT prefs FROM user_preferences WHERE user_id = $1', [req.user.id]);
    res.json(rows[0]?.prefs ?? {});
  });

  app.put('/api/me/preferences', async (req, res) => {
    const prefs = z.record(z.unknown()).parse(req.body);
    await db.query(
      `INSERT INTO user_preferences (user_id, prefs, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET prefs = user_preferences.prefs || EXCLUDED.prefs, updated_at = now()`,
      [req.user.id, JSON.stringify(prefs)],
    );
    const rows = await db.query('SELECT prefs FROM user_preferences WHERE user_id = $1', [req.user.id]);
    res.json(rows[0].prefs);
  });

  app.get('/api/me/saved-views', async (req, res) => {
    res.json(await db.query('SELECT id, view, name, params, created_at FROM saved_views WHERE user_id = $1 ORDER BY name', [req.user.id]));
  });

  app.post('/api/me/saved-views', async (req, res) => {
    const body = z.object({ view: str(100), name: str(100), params: z.record(z.string()) }).parse(req.body);
    const id = crypto.randomUUID();
    await db.query('INSERT INTO saved_views (id, user_id, view, name, params) VALUES ($1,$2,$3,$4,$5)', [id, req.user.id, body.view, body.name, JSON.stringify(body.params)]);
    res.status(201).json({ id, ...body });
  });

  app.delete('/api/me/saved-views/:id', async (req, res) => {
    await db.query('DELETE FROM saved_views WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  });

  app.get('/api/meta/filters', async (req, res) => {
    res.json(await filterOptions(db, req.scope));
  });

  app.get('/api/overview', async (req, res) => {
    await applyRiskExpiry(db, req.scope.customerIds);
    res.json(await buildOverview(db, req.scope, req.query as any));
  });

  app.get('/api/portfolio', async (req, res) => {
    res.json(await drillDown(db, req.scope, req.query as any));
  });

  app.get('/api/records/:entity', async (req, res) => {
    if (req.params.entity === 'risk' || req.params.entity === 'hardening') await applyRiskExpiry(db, req.scope.customerIds);
    res.json(await listEntity(db, req.scope, req.params.entity, req.query as ListParams));
  });

  app.get('/api/records/:entity/:id', async (req, res) => {
    const { entity, id } = req.params;
    if (entity === 'risk' || entity === 'hardening') await applyRiskExpiry(db, req.scope.customerIds);
    const record = await getEntity(db, req.scope, entity, id);
    const related = await relatedRecords(db, req.scope, record);
    const auditEntity = entity === 'risk' ? 'risk_acceptance' : entity;
    const audit = await db.query(
      `SELECT id, at, actor_name, actor_role, action, detail FROM audit_log WHERE entity = $1 AND entity_id = $2 AND customer_id = ANY($3::text[]) ORDER BY at, seq`,
      [auditEntity, id, [...req.scope.customerIds]],
    );
    let extra: Record<string, unknown> = {};
    if (entity === 'hardening') {
      extra.acceptanceHistory = await db.query(
        `SELECT a.id, a.status, a.review_required, a.decision_at, a.expiry_at, a.control_version, a.self_approved, l.approved_scope
         FROM risk_acceptances a JOIN risk_acceptance_objects l ON l.acceptance_id = a.id
         WHERE a.control_id = $1 AND l.object_id = $2 AND a.customer_id = $3 ORDER BY a.created_at DESC`,
        [record.control_id, record.object_id, record.customer_id],
      );
    }
    if (entity === 'risk') {
      const authority = await getRiskAuthority(db, req.user.id, record.customer_id);
      const designated = req.user.id === record.approver_id || req.user.id === record.risk_owner_id;
      const canDecide = authority !== null && (designated || authority === 'delegate');
      extra = {
        allowedTransitions: RISK_TRANSITIONS[record.status as keyof typeof RISK_TRANSITIONS],
        canDecide,
        isRequester: req.user.id === record.requester_id,
        renewals: await db.query(`SELECT id, status FROM risk_acceptances WHERE renewed_from_id = $1 ORDER BY created_at`, [id]),
      };
    }
    res.json({ record, related, audit, ...extra });
  });

  app.get('/api/hardening/summary', async (req, res) => {
    await applyRiskExpiry(db, req.scope.customerIds);
    res.json(await hardeningSummary(db, req.scope, req.query as any));
  });

  // Risk acceptance workflow. The actor always comes from the session.
  app.get('/api/risk/approvers', async (req, res) => {
    res.json(await approverOptions(db, req.scope, String(req.query.customerId ?? '')));
  });
  app.post('/api/risk', async (req, res) => {
    await applyRiskExpiry(db, req.scope.customerIds);
    res.status(201).json(await createRisk(db, req.scope, req.user, riskCreateBody.parse(req.body)));
  });
  app.patch('/api/risk/:id', async (req, res) => {
    res.json(await updateDraft(db, req.scope, req.user, req.params.id, riskPatchBody.parse(req.body)));
  });
  app.post('/api/risk/:id/submit', async (req, res) => {
    res.json(await submitRisk(db, req.scope, req.user, req.params.id));
  });
  app.post('/api/risk/:id/approve', async (req, res) => {
    const { confirmSelfApproval } = z.object({ confirmSelfApproval: z.boolean().optional() }).parse(req.body ?? {});
    res.json(await approveRisk(db, req.scope, req.user, req.params.id, confirmSelfApproval === true));
  });
  app.post('/api/risk/:id/reject', async (req, res) => {
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) throw conflict('A reason is required to reject a request');
    res.json(await rejectRisk(db, req.scope, req.user, req.params.id, parsed.data.reason));
  });
  app.post('/api/risk/:id/revoke', async (req, res) => {
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) throw conflict('A reason is required to revoke an acceptance');
    res.json(await revokeRisk(db, req.scope, req.user, req.params.id, parsed.data.reason));
  });
  app.post('/api/risk/:id/renew', async (req, res) => {
    res.status(201).json(await renewRisk(db, req.scope, req.user, req.params.id));
  });
  app.post('/api/risk/:id/scope', async (req, res) => {
    const { objectIds } = z.object({ objectIds: z.array(z.string()) }).parse(req.body);
    res.json(await changeRiskScope(db, req.scope, req.user, req.params.id, objectIds));
  });
  app.post('/api/admin/controls/:id/new-version', async (req, res) => {
    res.json(await publishControlVersion(db, req.scope, req.user, req.params.id));
  });

  // Availability and SLA.
  const slaPeriod = (req: Request, now: Date) => {
    try {
      return resolvePeriod((String(req.query.period ?? 'current_month')) as PeriodKey, now, req.query.from as string, req.query.to as string);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  };

  app.get('/api/sla', async (req, res) => {
    const now = new Date();
    const period = slaPeriod(req, now);
    const data = await loadSlaData(db, req.scope, req.query.customerId as string | undefined);
    res.json({ period: periodInfo(period), customers: buildSla(data, period, now) });
  });

  app.get('/api/sla/history', async (req, res) => {
    const level = z.enum(['customer', 'service', 'object']).parse(req.query.level);
    const id = String(req.query.id ?? '');
    const table = level === 'customer' ? 'customers' : level === 'service' ? 'services' : 'objects';
    const rows = await db.query(`SELECT ${level === 'customer' ? 'id' : 'customer_id'} AS customer_id FROM ${table} WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound();
    assertInScope(req.scope, rows[0].customer_id);
    const data = await loadSlaData(db, req.scope, rows[0].customer_id);
    res.json(slaHistory(data, new Date(), level, id));
  });

  app.put('/api/sla/config/customer/:id', async (req, res) => {
    adminOnly(req);
    assertInScope(req.scope, req.params.id);
    const body = slaCustomerBody.parse(req.body);
    const before = await db.query('SELECT exclude_planned_maintenance FROM customers WHERE id = $1', [req.params.id]);
    await db.query('UPDATE customers SET exclude_planned_maintenance = $2 WHERE id = $1', [req.params.id, body.exclude_planned_maintenance]);
    await writeAudit(db, req.user, req.params.id, 'sla_config', req.params.id, 'maintenance_rule_changed', { before: before[0], after: body });
    res.json({ ok: true });
  });

  for (const [path_, table] of [['service', 'services'], ['object', 'objects']] as const) {
    app.patch(`/api/sla/config/${path_}/:id`, async (req, res) => {
      adminOnly(req);
      const rows = await db.query(`SELECT customer_id, sla_weight, sla_included FROM ${table} WHERE id = $1`, [req.params.id]);
      if (!rows[0]) throw notFound();
      assertInScope(req.scope, rows[0].customer_id);
      const parsed = weightBody.safeParse(req.body);
      if (!parsed.success) throw badRequest('Included weights must be positive numbers');
      const next = { weight: parsed.data.weight ?? rows[0].sla_weight, included: parsed.data.included ?? rows[0].sla_included };
      await db.query(`UPDATE ${table} SET sla_weight = $2, sla_included = $3 WHERE id = $1`, [req.params.id, next.weight, next.included]);
      await writeAudit(db, req.user, rows[0].customer_id, 'sla_config', req.params.id, `${path_}_weight_changed`, { before: { weight: rows[0].sla_weight, included: rows[0].sla_included }, after: next });
      res.json(next);
    });
  }

  app.get('/api/audit', async (req, res) => {
    const entity = str(50).parse(req.query.entity);
    const ids = narrowCustomers(req.scope, req.query.customerId as string | undefined);
    res.json(await db.query(
      `SELECT id, at, actor_name, actor_role, action, entity_id, detail FROM audit_log
       WHERE entity = $1 AND customer_id = ANY($2::text[]) ORDER BY at DESC, seq DESC LIMIT 50`,
      [entity, ids],
    ));
  });

  // Lifecycle and licensing. All three roles may edit inside their scope.
  app.patch('/api/lifecycle/:id', async (req, res) => {
    const body = lifecyclePatch.parse(req.body);
    const record = await getEntity(db, req.scope, 'lifecycle', req.params.id);
    const next = { owner: body.owner ?? record.owner, plan: body.plan ?? record.plan };
    await db.tx(async (tx) => {
      await tx.query('UPDATE lifecycle_records SET owner = $2, plan = $3, updated_at = now() WHERE id = $1', [record.id, next.owner, next.plan]);
      await writeAudit(tx, req.user, record.customer_id, 'lifecycle', record.id, 'edited', { before: { owner: record.owner, plan: record.plan }, after: next });
    });
    res.json(await getEntity(db, req.scope, 'lifecycle', record.id));
  });

  app.patch('/api/licenses/:id', async (req, res) => {
    const parsed = licensePatch.safeParse(req.body);
    if (!parsed.success) throw badRequest(`Invalid license values: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const body = parsed.data;
    const record = await getEntity(db, req.scope, 'licenses', req.params.id);
    const date = (value: string | undefined, current: unknown) => {
      if (value === undefined) return new Date(current as string);
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw badRequest('Dates must be valid');
      return d;
    };
    const renewal = date(body.renewal_at, record.renewal_at);
    const validFrom = date(body.valid_from, record.valid_from);
    if (renewal <= validFrom) throw badRequest('The renewal date must be after the validity start date');
    const consumption = body.consumption === undefined ? record.consumption : body.consumption;
    const measuredChanged = body.consumption !== undefined && body.consumption !== record.consumption;
    const next = {
      owner: body.owner ?? record.owner,
      entitlement: body.entitlement ?? record.entitlement,
      assigned: body.assigned === undefined ? record.assigned : body.assigned,
      consumption,
      completeness: consumption === null ? null : body.completeness === undefined ? record.completeness : body.completeness,
      contract_ref: body.contract_ref ?? record.contract_ref,
    };
    const measuredAt = consumption === null ? null : measuredChanged ? new Date() : record.measured_at;
    const auditView = (v: { owner: unknown; entitlement: unknown; assigned: unknown; consumption: unknown; completeness: unknown; contract_ref: unknown }, renewalAt: unknown, validAt: unknown) => ({
      owner: v.owner, entitlement: v.entitlement, assigned: v.assigned, consumption: v.consumption, completeness: v.completeness, contract_ref: v.contract_ref,
      renewal_at: new Date(renewalAt as string).toISOString(), valid_from: new Date(validAt as string).toISOString(),
    });
    const auditBefore = auditView(record as any, record.renewal_at, record.valid_from);
    const auditAfter = auditView(next, renewal, validFrom);
    if (JSON.stringify(auditBefore) === JSON.stringify(auditAfter)) return void res.json(record);
    await db.tx(async (tx) => {
      await tx.query(
        `UPDATE licenses SET owner=$2, entitlement=$3, assigned=$4, consumption=$5, completeness=$6, contract_ref=$7, renewal_at=$8, valid_from=$9, measured_at=$10, updated_at=now() WHERE id=$1`,
        [record.id, next.owner, next.entitlement, next.assigned, next.consumption, next.completeness, next.contract_ref, renewal, validFrom, measuredAt],
      );
      await writeAudit(tx, req.user, record.customer_id, 'licenses', record.id, 'edited', { before: auditBefore, after: auditAfter });
    });
    res.json(await getEntity(db, req.scope, 'licenses', record.id));
  });

  app.get('/api/licenses/summary', async (req, res) => {
    res.json(await licenseSummary(db, req.scope, req.query.customerId as string | undefined));
  });

  app.get('/api/settings/reminders/:customerId', async (req, res) => {
    assertInScope(req.scope, req.params.customerId);
    const rows = await db.query('SELECT * FROM reminder_settings WHERE customer_id = $1', [req.params.customerId]);
    res.json(rows[0]);
  });

  app.put('/api/settings/reminders/:customerId', async (req, res) => {
    assertInScope(req.scope, req.params.customerId);
    const parsed = reminderBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Reminder days must be whole numbers from 1 to 1095');
    const current = (await db.query('SELECT * FROM reminder_settings WHERE customer_id = $1', [req.params.customerId]))[0];
    const next = { risk_days: parsed.data.risk_days ?? current.risk_days, lifecycle_days: parsed.data.lifecycle_days ?? current.lifecycle_days, license_days: parsed.data.license_days ?? current.license_days };
    await db.query('UPDATE reminder_settings SET risk_days=$2, lifecycle_days=$3, license_days=$4 WHERE customer_id=$1', [req.params.customerId, JSON.stringify(next.risk_days), JSON.stringify(next.lifecycle_days), JSON.stringify(next.license_days)]);
    await writeAudit(db, req.user, req.params.customerId, 'reminder_settings', req.params.customerId, 'edited', { before: { risk_days: current.risk_days, lifecycle_days: current.lifecycle_days, license_days: current.license_days }, after: next });
    res.json(next);
  });

  // Notifications.
  let lastSweepAt = 0;
  app.get('/api/notifications', async (req, res) => {
    await applyRiskExpiry(db, req.scope.customerIds);
    if (Date.now() - lastSweepAt > 5 * 60_000) {
      lastSweepAt = Date.now();
      await runReminderSweep(db);
    }
    res.json(await listNotifications(db, req.scope));
  });
  app.post('/api/notifications/read', async (req, res) => {
    const { id } = z.object({ id: z.string().optional() }).parse(req.body ?? {});
    await markRead(db, req.scope, id ?? null);
    res.json({ ok: true });
  });

  // Integrations. Health is not customer data. Record counts are scoped.
  app.get('/api/integrations', async (req, res) => {
    const rows = await db.query('SELECT * FROM integrations ORDER BY name');
    const result = [];
    for (const r of rows) {
      const records = await adapters[r.id].fetchRecords(db);
      const runs = await db.query('SELECT started_at, finished_at, status FROM integration_runs WHERE integration_id = $1 ORDER BY started_at DESC LIMIT 1', [r.id]);
      result.push({ ...r, simulated: true, records_in_scope: records.filter((x) => req.scope.customerIds.includes(x.customer_id)).length, last_run: runs[0] ?? null });
    }
    res.json({ rows: result, canRefresh: req.user.role !== 'customer' });
  });

  app.post('/api/integrations/:id/refresh', async (req, res) => {
    if (req.user.role === 'customer') throw forbidden('Only ProIT staff can refresh an integration');
    const adapter = adapters[req.params.id];
    if (!adapter) throw notFound('Integration');
    const startedAt = new Date();
    const records = await adapter.fetchRecords(db);
    const finishedAt = new Date();
    await adapter.markSynced(db, records.map((r) => r.id), finishedAt);
    await db.query(`UPDATE integrations SET status = 'healthy', message = 'Simulated connection OK', last_success_at = $2, last_attempt_at = $2 WHERE id = $1`, [adapter.id, finishedAt]);
    await db.query('INSERT INTO integration_runs (id, integration_id, started_at, finished_at, status, records) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), adapter.id, startedAt, finishedAt, 'success', records.length]);
    res.json({ id: adapter.id, last_success_at: finishedAt, records_in_scope: records.filter((r) => req.scope.customerIds.includes(r.customer_id)).length });
  });

  app.get('/api/source/:integration/:id', async (req, res) => {
    const adapter = adapters[req.params.integration];
    if (!adapter) throw notFound('Integration');
    const record = await adapter.getRecord(db, req.params.id);
    if (!record) throw notFound();
    assertInScope(req.scope, record.customer_id);
    const integration = await db.query('SELECT name FROM integrations WHERE id = $1', [adapter.id]);
    res.json({ integration: integration[0].name, simulated: true, ...record });
  });

  app.use('/api', () => {
    throw notFound('API route');
  });

  const clientDir = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (err instanceof ZodError) return void res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ') });
    if (err instanceof RangeError) return void res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}
