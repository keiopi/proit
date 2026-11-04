import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, CEDAR_CUSTOMER, CUSTOMER, DELEGATE, IRONVALE_OWNER, MANAGER_A, MANAGER_B, RISK_OWNER, setup } from './helpers';
import { ENTITIES } from '../src/server/repos/records';
import { applyRiskExpiry } from '../src/server/repos/risk';
import { aggregateSla } from '../src/domain/sla';

type Ctx = Awaited<ReturnType<typeof setup>>;
let ctx: Ctx;

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

beforeAll(async () => {
  ctx = await setup();
});

const failedResult = async (customerId: string, result = 'failed') => {
  const rows = await ctx.db.query(`SELECT id, control_id, object_id FROM control_results WHERE customer_id = $1 AND result = $2 ORDER BY id LIMIT 1`, [customerId, result]);
  return rows[0];
};

const newRisk = (controlResultId: string, owner = RISK_OWNER) => ({
  controlResultId, justification: 'Vendor release pending', residualRisk: 'medium', compensatingControls: 'Segmentation',
  riskOwnerId: owner, approverId: owner, expiryAt: future(120), reviewAt: future(60),
});

describe('authentication', () => {
  it('rejects unauthenticated access to data', async () => {
    const { default: request } = await import('supertest');
    for (const url of ['/api/me', '/api/overview', '/api/records/alarms', '/api/notifications', '/api/sla', '/api/meta/filters']) {
      expect((await request(ctx.app).get(url)).status).toBe(401);
    }
  });

  it('issues an HTTP-only session cookie', async () => {
    const { default: request } = await import('supertest');
    const res = await request(ctx.app).post('/api/auth/login').send({ userId: CUSTOMER });
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(String(res.headers['set-cookie'])).toMatch(/SameSite=Lax/);
  });

  it('rejects state changes that are not JSON', async () => {
    const agent = await ctx.login(CUSTOMER);
    const res = await agent.post('/api/risk/whatever/submit').type('form').send('a=1');
    expect(res.status).toBe(415);
  });
});

describe('cross-customer isolation', () => {
  it('returns only the customer own rows for every list', async () => {
    const agent = await ctx.login(CUSTOMER);
    for (const entity of Object.keys(ENTITIES)) {
      const res = await agent.get(`/api/records/${entity}?pageSize=500`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThan(0);
      for (const row of res.body.rows) expect(row.customer_id).toBe('northbridge');
    }
  });

  it('ignores a customer filter outside the scope instead of widening it', async () => {
    const agent = await ctx.login(CUSTOMER);
    const res = await agent.get('/api/records/alarms?customerId=ironvale');
    expect(res.body.total).toBe(0);
    expect(res.body.rows).toEqual([]);
    expect(res.body.facets.status).toEqual({});
  });

  it('hides other customers from search, counts and filter options', async () => {
    const agent = await ctx.login(CUSTOMER);
    const search = await agent.get('/api/records/requests?q=INC-IVM');
    expect(search.body.total).toBe(0);
    const filters = await agent.get('/api/meta/filters');
    expect(filters.body.customers.map((c: any) => c.id)).toEqual(['northbridge']);
    expect(filters.body.objects.every((o: any) => o.customer_id === 'northbridge')).toBe(true);
    const overview = await agent.get('/api/overview?customerId=ironvale');
    expect(overview.body.kpis.openIncidents).toBe(0);
    expect(overview.body.kpis.sla.customers).toEqual([]);
    expect(overview.body.attention).toEqual([]);
    const sla = await agent.get('/api/sla?customerId=ironvale');
    expect(sla.body.customers).toEqual([]);
    const hardening = await agent.get('/api/hardening/summary?customerId=ironvale');
    expect(hardening.body.groups).toEqual([]);
    const licenses = await agent.get('/api/licenses/summary?customerId=ironvale');
    expect(licenses.body.portfolio).toEqual([]);
  });

  it('returns 404 for direct reads of another customer record', async () => {
    const agent = await ctx.login(CUSTOMER);
    const urls = [
      '/api/records/requests/INC-IVM-2001', '/api/records/alarms/ZBX-CDR-7000', '/api/records/risk/RA-IVM-PND',
      '/api/records/lifecycle/LC-iv-mes-app01-1', '/api/records/licenses/LIC-CDR-1',
      '/api/source/servicemanager/INC-IVM-2001', '/api/source/zabbix/ZBX-CDR-7000',
      '/api/sla/history?level=customer&id=ironvale', '/api/sla/history?level=object&id=obj-iv-mes-app01',
      '/api/risk/approvers?customerId=ironvale', '/api/settings/reminders/ironvale',
    ];
    for (const url of urls) expect((await agent.get(url)).status, url).toBe(404);
  });

  it('blocks direct writes to another customer record and leaves the data unchanged', async () => {
    const agent = await ctx.login(CUSTOMER);
    expect((await agent.patch('/api/lifecycle/LC-iv-mes-app01-1').send({ owner: 'Attacker' })).status).toBe(404);
    expect((await agent.patch('/api/licenses/LIC-IVM-1').send({ owner: 'Attacker' })).status).toBe(404);
    expect((await agent.post('/api/risk/RA-IVM-PND/approve').send({})).status).toBe(404);
    expect((await agent.post('/api/risk/RA-IVM-ACC/revoke').send({ reason: 'x' })).status).toBe(404);
    expect((await agent.post('/api/risk/RA-IVM-DRF/submit').send({})).status).toBe(404);
    expect((await agent.patch('/api/risk/RA-IVM-DRF').send({ justification: 'x' })).status).toBe(404);
    expect((await agent.put('/api/settings/reminders/ironvale').send({ risk_days: [1] })).status).toBe(404);
    const ironvale = await failedResult('ironvale');
    expect((await agent.post('/api/risk').send(newRisk(ironvale.id))).status).toBe(404);
    const rows = await ctx.db.query(`SELECT owner FROM lifecycle_records WHERE id = 'LC-iv-mes-app01-1'`);
    expect(rows[0].owner).not.toBe('Attacker');
  });

  it('ignores identity and customer fields sent by the browser', async () => {
    const agent = await ctx.login(CUSTOMER);
    const res = await agent.patch('/api/licenses/LIC-NBF-1').send({ owner: 'Nora Lind', customer_id: 'ironvale', role: 'admin', user_id: ADMIN });
    expect(res.status).toBe(200);
    expect(res.body.customer_id).toBe('northbridge');
    const me = await agent.get('/api/me');
    expect(me.body.user.role).toBe('customer');
  });

  it('scopes notifications', async () => {
    const agent = await ctx.login(CEDAR_CUSTOMER);
    const res = await agent.get('/api/notifications');
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((n: any) => n.customer_id === 'cedar')).toBe(true);
  });

  it('cannot mark another user notification as read', async () => {
    const owner = await ctx.login(CEDAR_CUSTOMER);
    const list = await owner.get('/api/notifications');
    const target = list.body.rows[0];
    const other = await ctx.login(CUSTOMER);
    await other.post('/api/notifications/read').send({ id: target.id });
    const after = await ctx.db.query('SELECT read_at FROM notifications WHERE id = $1', [target.id]);
    expect(after[0].read_at).toBeNull();
  });
});

describe('manager portfolio', () => {
  it('sees only assigned customers', async () => {
    const a = await ctx.login(MANAGER_A);
    const filters = await a.get('/api/meta/filters');
    expect(filters.body.customers.map((c: any) => c.id).sort()).toEqual(['ironvale', 'northbridge']);
    const b = await ctx.login(MANAGER_B);
    expect((await b.get('/api/meta/filters')).body.customers.map((c: any) => c.id)).toEqual(['cedar']);
    const alarms = await a.get('/api/records/alarms?pageSize=500');
    expect(new Set(alarms.body.rows.map((r: any) => r.customer_id))).toEqual(new Set(['northbridge', 'ironvale']));
    expect((await a.get('/api/records/alarms/ZBX-CDR-7000')).status).toBe(404);
  });

  it('drills from customer to service to system to object', async () => {
    const a = await ctx.login(MANAGER_A);
    const top = await a.get('/api/portfolio');
    expect(top.body.level).toBe('customer');
    expect(top.body.rows.map((r: any) => r.id).sort()).toEqual(['ironvale', 'northbridge']);
    const services = await a.get('/api/portfolio?customerId=ironvale');
    expect(services.body.level).toBe('service');
    const service = services.body.rows[0];
    const systems = await a.get(`/api/portfolio?customerId=ironvale&serviceId=${service.id}`);
    expect(systems.body.level).toBe('system');
    const objects = await a.get(`/api/portfolio?customerId=ironvale&serviceId=${service.id}&systemId=${systems.body.rows[0].id}`);
    expect(objects.body.level).toBe('object');
    expect(objects.body.trail).toHaveLength(3);
    expect((await a.get('/api/portfolio?customerId=cedar')).status).toBe(404);
  });

  it('cannot switch to all customers', async () => {
    const a = await ctx.login(MANAGER_A);
    expect((await a.post('/api/me/portfolio-mode').send({ mode: 'all' })).status).toBe(403);
    const customer = await ctx.login(CUSTOMER);
    expect((await customer.post('/api/me/portfolio-mode').send({ mode: 'all' })).status).toBe(403);
    expect((await customer.get('/api/meta/filters')).body.customers).toHaveLength(1);
  });
});

describe('administrator scope switching', () => {
  it('starts on the assigned portfolio and switches explicitly', async () => {
    const admin = await ctx.login(ADMIN);
    const own = await admin.get('/api/me');
    expect(own.body.mode).toBe('own');
    expect(own.body.customers.map((c: any) => c.id).sort()).toEqual(['cedar', 'ironvale']);
    expect((await admin.get('/api/records/alarms/ZBX-NBF-7000')).status).toBe(404);

    expect((await admin.post('/api/me/portfolio-mode').send({ mode: 'all' })).status).toBe(200);
    const all = await admin.get('/api/me');
    expect(all.body.mode).toBe('all');
    expect(all.body.customers).toHaveLength(3);
    expect((await admin.get('/api/records/alarms/ZBX-NBF-7000')).status).toBe(200);

    await admin.post('/api/me/portfolio-mode').send({ mode: 'own' });
    expect((await admin.get('/api/records/alarms/ZBX-NBF-7000')).status).toBe(404);
  });

  it('keeps the mode per session rather than trusting a request parameter', async () => {
    const admin = await ctx.login(ADMIN);
    const res = await admin.get('/api/records/alarms?mode=all&portfolioMode=all&customerId=northbridge');
    expect(res.body.total).toBe(0);
  });
});

describe('risk approval authority', () => {
  const pendingFor = async (customer: string, requesterId: string, owner: string) => {
    const result = await failedResult(customer);
    const agent = await ctx.login(requesterId);
    const created = await agent.post('/api/risk').send(newRisk(result.id, owner));
    expect(created.status).toBe(201);
    const submitted = await agent.post(`/api/risk/${created.body.id}/submit`).send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('pending');
    return created.body.id as string;
  };

  it('does not grant approval through the administrator role, even in all mode', async () => {
    const id = await pendingFor('northbridge', CUSTOMER, RISK_OWNER);
    const admin = await ctx.login(ADMIN);
    await admin.post('/api/me/portfolio-mode').send({ mode: 'all' });
    expect((await admin.post(`/api/risk/${id}/approve`).send({})).status).toBe(403);
    expect((await admin.post(`/api/risk/${id}/reject`).send({ reason: 'no' })).status).toBe(403);
    const detail = await admin.get(`/api/records/risk/${id}`);
    expect(detail.body.record.status).toBe('pending');
    expect(detail.body.canDecide).toBe(false);
  });

  it('refuses a manager and a plain customer', async () => {
    const id = await pendingFor('northbridge', CUSTOMER, RISK_OWNER);
    const manager = await ctx.login(MANAGER_A);
    expect((await manager.post(`/api/risk/${id}/approve`).send({})).status).toBe(403);
    const customer = await ctx.login(CUSTOMER);
    expect((await customer.post(`/api/risk/${id}/approve`).send({ confirmSelfApproval: true })).status).toBe(403);
  });

  it('refuses a risk owner of another customer', async () => {
    const id = await pendingFor('northbridge', CUSTOMER, RISK_OWNER);
    const other = await ctx.login(IRONVALE_OWNER);
    expect((await other.post(`/api/risk/${id}/approve`).send({})).status).toBe(404);
  });

  it('refuses to designate someone without authority as approver', async () => {
    const result = await failedResult('northbridge');
    const agent = await ctx.login(CUSTOMER);
    const res = await agent.post('/api/risk').send({ ...newRisk(result.id), approverId: ADMIN });
    expect(res.status).toBe(400);
  });

  it('lets the designated owner approve, with an audit entry', async () => {
    const id = await pendingFor('northbridge', CUSTOMER, RISK_OWNER);
    const owner = await ctx.login(RISK_OWNER);
    const res = await owner.post(`/api/risk/${id}/approve`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.self_approved).toBe(false);
    const detail = await owner.get(`/api/records/risk/${id}`);
    const actions = detail.body.audit.map((a: any) => a.action);
    expect(actions).toEqual(['created', 'submitted', 'approved']);
    expect(detail.body.audit[2].actor_name).toBe('Nina Vance');
  });

  it('lets an explicit delegate approve', async () => {
    const id = await pendingFor('northbridge', CUSTOMER, RISK_OWNER);
    const delegate = await ctx.login(DELEGATE);
    const res = await delegate.post(`/api/risk/${id}/approve`).send({});
    expect(res.status).toBe(200);
    const detail = await delegate.get(`/api/records/risk/${id}`);
    expect(detail.body.audit.at(-1).detail.authority).toBe('delegate');
  });

  it('requires confirmation for self-approval and audits it', async () => {
    const id = await pendingFor('northbridge', RISK_OWNER, RISK_OWNER);
    const owner = await ctx.login(RISK_OWNER);
    expect((await owner.post(`/api/risk/${id}/approve`).send({})).status).toBe(409);
    const res = await owner.post(`/api/risk/${id}/approve`).send({ confirmSelfApproval: true });
    expect(res.status).toBe(200);
    expect(res.body.self_approved).toBe(true);
    const detail = await owner.get(`/api/records/risk/${id}`);
    const entry = detail.body.audit.at(-1);
    expect(entry.action).toBe('self_approved');
    expect(entry.detail.self_approved).toBe(true);
  });
});

describe('risk state transitions', () => {
  const draft = async () => {
    const result = await failedResult('northbridge', 'warning');
    const agent = await ctx.login(CUSTOMER);
    const res = await agent.post('/api/risk').send(newRisk(result.id));
    return { agent, id: res.body.id as string };
  };

  it('only allows risk requests for Failed or Warning controls', async () => {
    const agent = await ctx.login(CUSTOMER);
    const passed = await failedResult('northbridge', 'passed');
    expect((await agent.post('/api/risk').send(newRisk(passed.id))).status).toBe(400);
  });

  it('rejects invalid transitions', async () => {
    const owner = await ctx.login(RISK_OWNER);
    const { agent, id } = await draft();
    expect((await owner.post(`/api/risk/${id}/approve`).send({})).status).toBe(409);
    expect((await owner.post(`/api/risk/${id}/revoke`).send({ reason: 'x' })).status).toBe(409);
    await agent.post(`/api/risk/${id}/submit`).send({});
    expect((await agent.post(`/api/risk/${id}/submit`).send({})).status).toBe(409);
    expect((await agent.patch(`/api/risk/${id}`).send({ justification: 'changed' })).status).toBe(409);
    expect((await owner.post('/api/risk/RA-NBF-REJ/approve').send({})).status).toBe(409);
    expect((await owner.post('/api/risk/RA-NBF-OLD/approve').send({})).status).toBe(409);
    expect((await owner.post('/api/risk/RA-NBF-RVK/approve').send({})).status).toBe(409);
  });

  it('allows draft edits', async () => {
    const { agent, id } = await draft();
    const res = await agent.patch(`/api/risk/${id}`).send({ justification: 'Updated justification' });
    expect(res.status).toBe(200);
    expect(res.body.justification).toBe('Updated justification');
  });

  it('requires a reason to reject and revoke', async () => {
    const owner = await ctx.login(RISK_OWNER);
    expect((await owner.post('/api/risk/RA-NBF-PND/reject').send({})).status).toBe(409);
    expect((await owner.post('/api/risk/RA-NBF-PND/reject').send({ reason: '  ' })).status).toBe(409);
    expect((await owner.post('/api/risk/RA-NBF-ACC/revoke').send({})).status).toBe(409);
  });

  it('expires on read when the date has passed, and writes an audit entry', async () => {
    const { id, agent } = await draft();
    const owner = await ctx.login(RISK_OWNER);
    await agent.post(`/api/risk/${id}/submit`).send({});
    await owner.post(`/api/risk/${id}/approve`).send({});
    await ctx.db.query(`UPDATE risk_acceptances SET expiry_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    const read = await owner.get(`/api/records/risk/${id}`);
    expect(read.body.record.status).toBe('expired');
    expect(read.body.audit.at(-1).action).toBe('expired');
    expect((await owner.post(`/api/risk/${id}/revoke`).send({ reason: 'late' })).status).toBe(409);
  });

  it('renews with a link and preserves the previous decision', async () => {
    const owner = await ctx.login(RISK_OWNER);
    const before = (await owner.get('/api/records/risk/RA-NBF-OLD')).body.record;
    const res = await owner.post('/api/risk/RA-NBF-OLD/renew').send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.renewed_from_id).toBe('RA-NBF-OLD');
    const after = await owner.get('/api/records/risk/RA-NBF-OLD');
    expect(after.body.record.status).toBe(before.status);
    expect(after.body.record.decision_at).toBe(before.decision_at);
    expect(after.body.renewals.map((r: any) => r.id)).toContain(res.body.id);
    expect((await owner.post('/api/risk/RA-NBF-REJ/renew').send({})).status).toBe(409);
  });

  it('flags review when the scope changes and does not cover the new object', async () => {
    const owner = await ctx.login(RISK_OWNER);
    const current = (await owner.get('/api/records/risk/RA-NBF-SLF')).body.record;
    const objects = await ctx.db.query(`SELECT id FROM objects WHERE customer_id = 'northbridge' AND id NOT IN (SELECT object_id FROM control_results WHERE control_id = $1) LIMIT 1`, [current.control_id]);
    const added = objects[0].id;
    await ctx.db.query(
      `INSERT INTO control_results (id, customer_id, service_id, system_id, object_id, control_id, result, actual_result, evidence, scanned_at)
       SELECT 'CR-TEST', customer_id, service_id, system_id, id, $1, 'failed', 'x', 'x', now() FROM objects WHERE id = $2`,
      [current.control_id, added],
    );
    const res = await owner.post('/api/risk/RA-NBF-SLF/scope').send({ objectIds: [...current.object_ids, added] });
    expect(res.status).toBe(200);
    expect(res.body.review_required).toBe(true);
    expect(res.body.effective).toBe(false);
    expect(res.body.buckets).toContain('review_required');
    expect(res.body.affected_objects.find((o: any) => o.id === added).approved_scope).toBe(false);
    expect(res.body.review_reason).not.toMatch(/obj-/);

    const results = await owner.get(`/api/records/hardening?objectId=${added}&pageSize=500`);
    const row = results.body.rows.find((r: any) => r.control_id === current.control_id);
    expect(row.acceptance_status).not.toBe('accepted');
  });

  it('flags review when the control version changes, for administrators only', async () => {
    const customer = await ctx.login(CUSTOMER);
    const risk = (await customer.get('/api/records/risk/RA-NBF-ACC')).body.record;
    expect((await customer.post(`/api/admin/controls/${risk.control_id}/new-version`).send({})).status).toBe(403);
    const admin = await ctx.login(ADMIN);
    await admin.post('/api/me/portfolio-mode').send({ mode: 'all' });
    const res = await admin.post(`/api/admin/controls/${risk.control_id}/new-version`).send({});
    expect(res.status).toBe(200);
    expect(res.body.flagged).toContain('RA-NBF-ACC');
    const after = (await customer.get('/api/records/risk/RA-NBF-ACC')).body.record;
    expect(after.review_required).toBe(true);
    expect(after.review_reason).toMatch(/Control version changed/);
    expect(after.status).toBe('accepted');
  });

  it('refuses affected objects without a Failed or Warning result for the control', async () => {
    const owner = await ctx.login(RISK_OWNER);
    const risk = (await owner.get('/api/records/risk/RA-NBF-RVW')).body.record;
    const other = await ctx.db.query(`SELECT id FROM objects WHERE customer_id = 'northbridge' AND id NOT IN (SELECT object_id FROM control_results WHERE control_id = $1) LIMIT 1`, [risk.control_id]);
    const res = await owner.post('/api/risk/RA-NBF-RVW/scope').send({ objectIds: [...risk.object_ids, other[0].id] });
    expect(res.status).toBe(400);
  });

  it('records only the fields that really changed on a draft', async () => {
    const { agent, id } = await draft();
    await agent.patch(`/api/risk/${id}`).send({ justification: 'Only this changed', residualRisk: 'medium', riskOwnerId: RISK_OWNER });
    const detail = await agent.get(`/api/records/risk/${id}`);
    expect(detail.body.audit.at(-1).detail.changed).toEqual(['justification']);
    await agent.patch(`/api/risk/${id}`).send({ justification: 'Only this changed' });
    expect((await agent.get(`/api/records/risk/${id}`)).body.audit).toHaveLength(detail.body.audit.length);
  });

  it('flags acceptances outside the administrator scope without revealing them', async () => {
    const admin = await ctx.login(ADMIN);
    await admin.post('/api/me/portfolio-mode').send({ mode: 'own' });
    const rows = await ctx.db.query(`
      SELECT a.id, a.control_id FROM risk_acceptances a
      WHERE a.customer_id = 'northbridge' AND a.status = 'accepted' AND a.review_required = false
        AND EXISTS (SELECT 1 FROM control_results r WHERE r.control_id = a.control_id AND r.customer_id IN ('ironvale', 'cedar')) LIMIT 1`);
    expect(rows[0]).toBeTruthy();
    const res = await admin.post(`/api/admin/controls/${rows[0].control_id}/new-version`).send({});
    expect(res.status).toBe(200);
    expect(res.body.flagged).not.toContain(rows[0].id);
    const flagged = await ctx.db.query('SELECT review_required FROM risk_acceptances WHERE id = $1', [rows[0].id]);
    expect(flagged[0].review_required).toBe(true);
  });

  it('expires nothing that is still in date', async () => {
    await applyRiskExpiry(ctx.db);
    const rows = await ctx.db.query(`SELECT status FROM risk_acceptances WHERE id = 'RA-CDR-ACC'`);
    expect(rows[0].status).toBe('accepted');
  });
});

describe('accepted exceptions leave technical results unchanged', () => {
  it('keeps the Failed result and the score after approval', async () => {
    const owner = await ctx.login('u-cole');
    const customer = await ctx.login(CEDAR_CUSTOMER);
    const candidates = await customer.get('/api/records/hardening?customerId=cedar&status=failed&pageSize=500');
    const target = candidates.body.rows.find((r: any) => r.acceptance_status === 'none');
    expect(target).toBeTruthy();
    const before = (await customer.get('/api/hardening/summary?customerId=cedar')).body.total;

    const created = await customer.post('/api/risk').send({ ...newRisk(target.id, 'u-cole') });
    expect(created.status).toBe(201);
    await customer.post(`/api/risk/${created.body.id}/submit`).send({});
    expect((await owner.post(`/api/risk/${created.body.id}/approve`).send({})).status).toBe(200);

    const detail = await customer.get(`/api/records/hardening/${target.id}`);
    expect(detail.body.record.result).toBe('failed');
    expect(detail.body.record.acceptance_status).toBe('accepted');
    expect(detail.body.acceptanceHistory[0].id).toBe(created.body.id);

    const after = (await customer.get('/api/hardening/summary?customerId=cedar')).body.total;
    expect(after.score).toBe(before.score);
    expect(after.passed).toBe(before.passed);
    expect(after.failed).toBe(before.failed);
    expect(after.denominator).toBe(before.denominator);
    expect(after.accepted_exceptions).toBe(before.accepted_exceptions + 1);
  });

  it('shows "no evaluated controls" as a null score', async () => {
    const agent = await ctx.login(CEDAR_CUSTOMER);
    const res = await agent.get('/api/hardening/summary?customerId=cedar&groupBy=object');
    const row = res.body.groups.find((g: any) => g.name === 'cd-loy-etl01');
    expect(row.score).toBeNull();
    expect(row.denominator).toBe(0);
    expect(row.not_checked).toBeGreaterThan(0);
  });
});

describe('SLA through the API', () => {
  it('reproduces customer SLA from its weights and service values', async () => {
    const agent = await ctx.login(MANAGER_A);
    const res = await agent.get('/api/sla?customerId=ironvale&period=previous_month');
    const c = res.body.customers[0];
    expect(c.aggregate.completeness).toBe('complete');
    const total = c.services.reduce((sum: number, s: any) => sum + s.sla_weight, 0);
    const expected = c.services.reduce((sum: number, s: any) => sum + (s.sla_weight / total) * s.value, 0);
    expect(c.value).toBeCloseTo(expected, 8);
    const service = c.services[0];
    const check = aggregateSla(service.objects.map((o: any) => ({ id: o.id, name: o.name, weight: o.sla_weight, included: o.sla_included, value: o.availability })));
    expect(service.value).toBeCloseTo(check.value!, 8);
  });

  it('marks an object without data Unknown and the aggregates Incomplete', async () => {
    const agent = await ctx.login(CEDAR_CUSTOMER);
    const res = await agent.get('/api/sla?period=current_month');
    const c = res.body.customers[0];
    const service = c.services.find((s: any) => s.name === 'Loyalty Analytics');
    const object = service.objects.find((o: any) => o.name === 'cd-loy-etl01');
    expect(object.availability).toBeNull();
    expect(object.sla_status).toBe('unknown');
    expect(object.current_status).toBe('unknown');
    expect(service.value).toBeNull();
    expect(service.aggregate.completeness).toBe('incomplete');
    expect(service.aggregate.missingWeightShare).toBeGreaterThan(0);
    expect(c.value).toBeNull();
    expect(c.sla_status).toBe('unknown');
  });

  it('allows weight and inclusion changes for administrators only, within scope, and audits them', async () => {
    const customer = await ctx.login(CUSTOMER);
    expect((await customer.patch('/api/sla/config/service/svc-northbridge-core').send({ weight: 9 })).status).toBe(403);
    const manager = await ctx.login(MANAGER_A);
    expect((await manager.patch('/api/sla/config/service/svc-northbridge-core').send({ weight: 9 })).status).toBe(403);
    const admin = await ctx.login(ADMIN);
    expect((await admin.patch('/api/sla/config/service/svc-northbridge-core').send({ weight: 9 })).status).toBe(404);
    expect((await admin.patch('/api/sla/config/service/svc-ironvale-erp').send({ weight: 0 })).status).toBe(400);
    expect((await admin.patch('/api/sla/config/service/svc-ironvale-erp').send({ weight: -1 })).status).toBe(400);
    const ok = await admin.patch('/api/sla/config/service/svc-ironvale-erp').send({ weight: 4 });
    expect(ok.status).toBe(200);
    const audit = await ctx.db.query(`SELECT action, detail FROM audit_log WHERE entity = 'sla_config' AND entity_id = 'svc-ironvale-erp'`);
    expect(audit[0].action).toBe('service_weight_changed');
    expect(audit[0].detail.after.weight).toBe(4);
    await admin.patch('/api/sla/config/service/svc-ironvale-erp').send({ weight: 2 });
  });

  it('changes results when the maintenance rule changes', async () => {
    const admin = await ctx.login(ADMIN);
    const read = async () => (await admin.get('/api/sla?customerId=ironvale&period=previous_month')).body.customers[0];
    const excluded = await read();
    await admin.put('/api/sla/config/customer/ironvale').send({ exclude_planned_maintenance: false });
    const counted = await read();
    expect(counted.value).toBeLessThan(excluded.value);
    await admin.put('/api/sla/config/customer/ironvale').send({ exclude_planned_maintenance: true });
  });
});

describe('persistence and audit', () => {
  it('persists lifecycle edits with history for any role in scope', async () => {
    for (const [user, id, owner] of [[CUSTOMER, 'LC-nb-core-app01-1', 'Owner A'], [MANAGER_A, 'LC-iv-mes-app01-1', 'Owner B'], [ADMIN, 'LC-cd-pos-app01-1', 'Owner C']]) {
      const agent = await ctx.login(user);
      const res = await agent.patch(`/api/lifecycle/${id}`).send({ owner, plan: 'Upgrade next quarter' });
      expect(res.status).toBe(200);
      const fresh = await ctx.login(user);
      const detail = await fresh.get(`/api/records/lifecycle/${id}`);
      expect(detail.body.record.owner).toBe(owner);
      expect(detail.body.record.plan).toBe('Upgrade next quarter');
      expect(detail.body.audit.at(-1).action).toBe('edited');
    }
  });

  it('persists license edits and validates values', async () => {
    const agent = await ctx.login(CUSTOMER);
    expect((await agent.patch('/api/licenses/LIC-NBF-1').send({ entitlement: -1 })).status).toBe(400);
    expect((await agent.patch('/api/licenses/LIC-NBF-1').send({ entitlement: 1.5 })).status).toBe(400);
    expect((await agent.patch('/api/licenses/LIC-NBF-1').send({ renewal_at: '2001-01-01' })).status).toBe(400);
    const res = await agent.patch('/api/licenses/LIC-NBF-1').send({ entitlement: 400, owner: 'License Owner' });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('potential_shortfall');
    const detail = await (await ctx.login(CUSTOMER)).get('/api/records/licenses/LIC-NBF-1');
    expect(detail.body.record.entitlement).toBe(400);
    expect(detail.body.audit.at(-1).detail.before.entitlement).toBe(500);
  });

  it('does not rewrite or audit a license saved without changes', async () => {
    const agent = await ctx.login(CUSTOMER);
    const before = (await agent.get('/api/records/licenses/LIC-NBF-3')).body;
    const res = await agent.patch('/api/licenses/LIC-NBF-3').send({ owner: before.record.owner });
    expect(res.status).toBe(200);
    const after = (await agent.get('/api/records/licenses/LIC-NBF-3')).body;
    expect(after.audit).toHaveLength(before.audit.length);
    expect(after.record.renewal_at).toBe(before.record.renewal_at);
  });

  it('keeps preferences and saved views separate per account', async () => {
    const nora = await ctx.login(CUSTOMER);
    const ivan = await ctx.login('u-ivan');
    await nora.put('/api/me/preferences').send({ theme: 'light', sidebarCollapsed: true });
    await ivan.put('/api/me/preferences').send({ theme: 'dark' });
    await nora.put('/api/me/preferences').send({ filters: { alarms: { severity: 'critical' } } });
    const fresh = await ctx.login(CUSTOMER);
    const prefs = (await fresh.get('/api/me/preferences')).body;
    expect(prefs.theme).toBe('light');
    expect(prefs.sidebarCollapsed).toBe(true);
    expect(prefs.filters.alarms.severity).toBe('critical');
    expect((await ivan.get('/api/me/preferences')).body.theme).toBe('dark');

    const saved = await nora.post('/api/me/saved-views').send({ view: 'alarms', name: 'Critical', params: { severity: 'critical' } });
    expect(saved.status).toBe(201);
    expect((await ivan.get('/api/me/saved-views')).body).toEqual([]);
    await ivan.delete(`/api/me/saved-views/${saved.body.id}`).set('Content-Type', 'application/json');
    expect((await fresh.get('/api/me/saved-views')).body).toHaveLength(1);
  });

  it('keeps the audit log append-only at the database level', async () => {
    const rows = await ctx.db.query('SELECT id FROM audit_log LIMIT 1');
    await expect(ctx.db.query(`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, [rows[0].id])).rejects.toThrow(/append-only/);
    await expect(ctx.db.query('DELETE FROM audit_log WHERE id = $1', [rows[0].id])).rejects.toThrow(/append-only/);
  });
});

describe('integrations', () => {
  it('runs the adapter workflow on refresh and updates the timestamp', async () => {
    const admin = await ctx.login(ADMIN);
    const before = (await admin.get('/api/integrations')).body.rows.find((r: any) => r.id === 'gitlab');
    expect(before.status).toBe('degraded');
    const res = await admin.post('/api/integrations/gitlab/refresh').send({});
    expect(res.status).toBe(200);
    const after = (await admin.get('/api/integrations')).body.rows.find((r: any) => r.id === 'gitlab');
    expect(after.status).toBe('healthy');
    expect(new Date(after.last_success_at).getTime()).toBeGreaterThan(new Date(before.last_success_at).getTime());
    expect(after.last_run.status).toBe('success');
  });

  it('does not let customers refresh, and scopes counts', async () => {
    const customer = await ctx.login(CUSTOMER);
    expect((await customer.post('/api/integrations/jira/refresh').send({})).status).toBe(403);
    const list = await customer.get('/api/integrations');
    const zabbix = list.body.rows.find((r: any) => r.id === 'zabbix');
    expect(zabbix.records_in_scope).toBe(12);
    expect(list.body.canRefresh).toBe(false);
  });

  it('labels source records as simulated', async () => {
    const customer = await ctx.login(CUSTOMER);
    const res = await customer.get('/api/source/zabbix/ZBX-NBF-7000');
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.fields.id).toBe('ZBX-NBF-7000');
  });
});

describe('lists', () => {
  it('sorts severity by rank rather than alphabetically', async () => {
    const agent = await ctx.login(CUSTOMER);
    const res = await agent.get('/api/records/requests?sort=priority&dir=desc&pageSize=500');
    const order = ['critical', 'high', 'medium', 'low'];
    const ranks = res.body.rows.map((r: any) => order.indexOf(r.priority));
    expect(ranks).toEqual([...ranks].sort((a: number, b: number) => a - b));
  });

  it('counts each facet with the other filter applied', async () => {
    const agent = await ctx.login(CUSTOMER);
    const res = await agent.get('/api/records/alarms?status=open&severity=critical&pageSize=500');
    expect(res.body.facets.severity.critical).toBe(res.body.total);
    expect(res.body.facets.status.resolved).toBe(
      (await agent.get('/api/records/alarms?status=resolved&severity=critical&pageSize=500')).body.total,
    );
  });
});

describe('seed coverage and consistency', () => {
  const values = async (sql: string) => new Set((await ctx.db.query(sql)).map((r: any) => r.v));

  it('seeds every required state', async () => {
    expect(await values('SELECT DISTINCT result AS v FROM control_results')).toEqual(new Set(['passed', 'failed', 'warning', 'not_applicable', 'not_checked']));
    expect(await values('SELECT DISTINCT severity AS v FROM alarms')).toEqual(new Set(['critical', 'warning']));
    const riskStatuses = await values('SELECT DISTINCT status AS v FROM risk_acceptances');
    for (const s of ['draft', 'pending', 'accepted', 'rejected', 'expired', 'revoked']) expect(riskStatuses.has(s), s).toBe(true);
    expect(await values(`SELECT DISTINCT object_type AS v FROM objects`)).toEqual(new Set(['windows', 'linux', 'database', 'network']));

    const admin = await ctx.login(ADMIN);
    await admin.post('/api/me/portfolio-mode').send({ mode: 'all' });
    const lifecycle = await admin.get('/api/records/lifecycle?pageSize=500');
    expect(Object.keys(lifecycle.body.facets.status).sort()).toEqual(['approaching', 'supported', 'unknown', 'unsupported']);
    const licenses = await admin.get('/api/records/licenses?pageSize=500');
    for (const s of ['surplus', 'potential_shortfall', 'missing_data']) expect(licenses.body.facets.status[s], s).toBeGreaterThan(0);
    expect(licenses.body.rows.some((l: any) => l.renewal_upcoming)).toBe(true);
    const sla = await admin.get('/api/sla?period=current_month');
    const statuses = new Set(sla.body.customers.flatMap((c: any) => c.services.flatMap((s: any) => s.objects.map((o: any) => o.sla_status))));
    expect(statuses).toEqual(new Set(['met', 'at_risk', 'breached', 'unknown']));
    const portfolio = await admin.get('/api/overview');
    const health = new Set(portfolio.body.portfolio.map((p: any) => p.health));
    expect(health.has('degraded')).toBe(true);
  });

  it('keeps every hierarchy link inside one customer', async () => {
    for (const table of ['requests_incidents', 'tasks', 'alarms', 'vulnerabilities', 'control_results', 'lifecycle_records']) {
      const bad = await ctx.db.query(`SELECT count(*)::int AS n FROM ${table} t JOIN objects o ON o.id = t.object_id WHERE o.customer_id <> t.customer_id OR o.service_id <> t.service_id OR o.system_id <> t.system_id`);
      expect(bad[0].n, table).toBe(0);
    }
  });

  it('matches the latest hardening scan to the current results', async () => {
    const rows = await ctx.db.query(`
      SELECT s.object_id, s.passed, s.failed, s.warning, s.not_applicable, s.not_checked,
        (SELECT count(*)::int FROM control_results r WHERE r.object_id = s.object_id AND r.result = 'passed' AND r.id <> 'CR-TEST') AS real_passed,
        (SELECT count(*)::int FROM control_results r WHERE r.object_id = s.object_id AND r.result = 'failed' AND r.id <> 'CR-TEST') AS real_failed
      FROM hardening_scans s WHERE s.id LIKE '%-0'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.passed).toBe(r.real_passed);
      expect(r.failed).toBe(r.real_failed);
    }
  });

  it('never ends a product life before its extended support', async () => {
    const bad = await ctx.db.query('SELECT id FROM lifecycle_records WHERE eol_at < extended_at OR eol_at < eos_at');
    expect(bad).toEqual([]);
  });

  it('links every risk acceptance to a real Failed or Warning result', async () => {
    const bad = await ctx.db.query(`
      SELECT a.id FROM risk_acceptances a JOIN risk_acceptance_objects l ON l.acceptance_id = a.id
      LEFT JOIN control_results r ON r.control_id = a.control_id AND r.object_id = l.object_id
      WHERE a.id LIKE 'RA-___-___' AND (r.result IS NULL OR r.result NOT IN ('failed', 'warning'))`);
    expect(bad).toEqual([]);
  });

  it('points KPI totals at the same data as the lists', async () => {
    const agent = await ctx.login(CUSTOMER);
    const overview = (await agent.get('/api/overview')).body.kpis;
    const incidents = await agent.get('/api/records/requests?kind=incident&status=open&pageSize=500');
    expect(overview.openIncidents).toBe(incidents.body.total);
    const mine = await agent.get('/api/records/requests?kind=request&status=open&mine=true&pageSize=500');
    expect(overview.myRequests).toBe(mine.body.total);
    expect(overview.myRequests).toBeGreaterThan(0);
  });
});
