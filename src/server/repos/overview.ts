import type { Db } from '../db/db';
import { narrowCustomers, type Scope } from '../auth';
import { emptyTally, scoreHardening, tally, type ControlResult } from '../../domain/hardening';
import { prioritize } from '../../domain/priority';
import { resolvePeriod, type Period, type PeriodKey } from '../../domain/periods';
import type { SlaStatus } from '../../domain/sla';
import { summarizeLicenses } from '../../domain/license';
import { loadRows } from './records';
import { buildSla, loadSlaData, type CustomerSla, type ServiceSla } from './sla';
import { notFound } from '../errors';

type Row = Record<string, any>;

const groupBy = (rows: Row[], field: string) => {
  const map = new Map<string, Row[]>();
  for (const r of rows) map.set(r[field], [...(map.get(r[field]) ?? []), r]);
  return map;
};

const OPEN_REQUEST = (r: Row) => !['resolved', 'closed'].includes(r.status);
const OPEN_ALARM = (r: Row) => r.status !== 'resolved';
const OPEN_VULN = (r: Row) => r.status !== 'resolved';
const OPEN_TASK = (r: Row) => !['done', 'closed'].includes(r.status);

export interface OverviewFilters { customerId?: string; period?: string; from?: string; to?: string }

export async function buildOverview(db: Db, scope: Scope, f: OverviewFilters, now = new Date()) {
  const period = resolvePeriod((f.period as PeriodKey) || 'current_month', now, f.from, f.to);
  const [requests, projects, tasks, alarms, vulns, results, lifecycle, licenses, risk, slaData] = await Promise.all([
    loadRows(db, scope, 'requests', f.customerId, now),
    loadRows(db, scope, 'projects', f.customerId, now),
    loadRows(db, scope, 'tasks', f.customerId, now),
    loadRows(db, scope, 'alarms', f.customerId, now),
    loadRows(db, scope, 'vulnerabilities', f.customerId, now),
    loadRows(db, scope, 'hardening', f.customerId, now),
    loadRows(db, scope, 'lifecycle', f.customerId, now),
    loadRows(db, scope, 'licenses', f.customerId, now),
    loadRows(db, scope, 'risk', f.customerId, now),
    loadSlaData(db, scope, f.customerId),
  ]);
  const sla = buildSla(slaData, period, now);

  const openRequests = requests.filter((r) => r.kind === 'request' && OPEN_REQUEST(r));
  const openIncidents = requests.filter((r) => r.kind === 'incident' && OPEN_REQUEST(r));
  const openAlarms = alarms.filter(OPEN_ALARM);
  const hardening = scoreHardening(tally(results.map((r) => r.result as ControlResult)));
  const acceptedExceptions = results.filter((r) => r.acceptance_status === 'accepted').length;

  const kpis = {
    myRequests: openRequests.filter((r) => r.assignee_id === scope.userId).length,
    openRequests: openRequests.length,
    openIncidents: openIncidents.length,
    criticalIncidents: openIncidents.filter((r) => r.severity === 'critical').length,
    activeProjects: projects.filter((p) => p.status !== 'done').length,
    openTasks: tasks.filter(OPEN_TASK).length,
    criticalAlarms: openAlarms.filter((a) => a.severity === 'critical').length,
    warningAlarms: openAlarms.filter((a) => a.severity === 'warning').length,
    criticalVulnerabilities: vulns.filter((v) => OPEN_VULN(v) && v.severity === 'critical').length,
    hardening: { score: hardening.score, denominator: hardening.denominator, coverage: hardening.coverage, notChecked: hardening.not_checked, acceptedExceptions },
    sla: {
      customers: sla.map((c) => ({ id: c.id, name: c.name, value: c.value, target: c.sla_target, status: c.sla_status })),
      met: sla.filter((c) => c.sla_status === 'met').length,
      atRisk: sla.filter((c) => c.sla_status === 'at_risk').length,
      breached: sla.filter((c) => c.sla_status === 'breached').length,
      unknown: sla.filter((c) => c.sla_status === 'unknown').length,
    },
    lifecycle: {
      unsupported: lifecycle.filter((l) => l.status === 'unsupported').length,
      approaching: lifecycle.filter((l) => l.status === 'approaching').length,
      unknown: lifecycle.filter((l) => l.status === 'unknown').length,
    },
    licenses: {
      shortfalls: licenses.filter((l) => l.state === 'potential_shortfall').length,
      renewals: licenses.filter((l) => l.renewal_upcoming).length,
      missing: licenses.filter((l) => l.state === 'missing_data').length,
    },
    risk: {
      pending: risk.filter((r) => r.buckets.includes('pending')).length,
      expiring: risk.filter((r) => r.buckets.includes('expiring')).length,
      reviewRequired: risk.filter((r) => r.buckets.includes('review_required')).length,
    },
  };

  const attention = buildAttention({ requests: openIncidents, alarms: openAlarms, vulns: vulns.filter(OPEN_VULN), lifecycle, licenses, risk, results, sla });
  return { period: periodInfo(period), kpis, attention, portfolio: portfolioRows(sla, { requests, alarms, vulns, results }) };
}

export const periodInfo = (p: Period) => ({ key: p.key, label: p.label, start: p.start.toISOString(), end: p.end.toISOString(), timezone: p.timezone });

function buildAttention(d: { requests: Row[]; alarms: Row[]; vulns: Row[]; lifecycle: Row[]; licenses: Row[]; risk: Row[]; results: Row[]; sla: CustomerSla[] }) {
  const slaOf = (customerId: string): SlaStatus => d.sla.find((c) => c.id === customerId)?.sla_status ?? 'unknown';
  const items: Row[] = [];
  const add = (entity: string, view: string, r: Row, severity: string, reason: string) => {
    const p = prioritize(severity, r.service_criticality ?? null, slaOf(r.customer_id));
    items.push({ id: r.id, entity, view, title: r.title, reason, severity, customer_id: r.customer_id, customer_name: r.customer_name, service_name: r.service_name ?? null, object_name: r.object_name ?? null, score: p.score, factors: p.factors });
  };
  for (const r of d.requests.filter((x) => x.severity === 'critical' || x.severity === 'high')) add('requests', '/requests', r, r.severity, 'Open incident');
  for (const a of d.alarms.filter((x) => x.severity === 'critical')) add('alarms', '/alarms', a, a.severity, `${a.status === 'active' ? 'Active' : 'Acknowledged'} critical alarm`);
  for (const v of d.vulns.filter((x) => x.severity === 'critical')) add('vulnerabilities', '/vulnerabilities', v, v.severity, `Critical vulnerability, CVSS ${v.cvss}`);
  for (const l of d.lifecycle.filter((x) => x.status === 'unsupported')) add('lifecycle', '/lifecycle', l, 'high', 'Past verified end of support');
  for (const l of d.licenses.filter((x) => x.state === 'potential_shortfall')) add('licenses', '/licenses', l, 'medium', `Potential shortfall of ${l.potential_shortfall} ${l.unit}(s)`);
  for (const r of d.risk.filter((x) => x.buckets.includes('review_required') || x.buckets.includes('pending'))) {
    add('risk', '/risk-acceptances', r, r.severity, r.buckets.includes('pending') ? 'Waiting for a risk decision' : 'Risk acceptance needs review');
  }
  return items.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 15);
}

interface Linked { requests: Row[]; alarms: Row[]; vulns: Row[]; results: Row[] }

function metrics(l: Linked, match: (r: Row) => boolean) {
  const t = emptyTally();
  for (const r of l.results.filter(match)) t[r.result as ControlResult]++;
  const score = scoreHardening(t);
  return {
    open_incidents: l.requests.filter((r) => match(r) && r.kind === 'incident' && OPEN_REQUEST(r)).length,
    open_requests: l.requests.filter((r) => match(r) && r.kind === 'request' && OPEN_REQUEST(r)).length,
    critical_alarms: l.alarms.filter((a) => match(a) && OPEN_ALARM(a) && a.severity === 'critical').length,
    warning_alarms: l.alarms.filter((a) => match(a) && OPEN_ALARM(a) && a.severity === 'warning').length,
    critical_vulns: l.vulns.filter((v) => match(v) && OPEN_VULN(v) && v.severity === 'critical').length,
    hardening_score: score.score,
    hardening_denominator: score.denominator,
  };
}

function health(status: SlaStatus, m: ReturnType<typeof metrics>): 'healthy' | 'degraded' | 'unknown' {
  if (m.critical_alarms > 0 || status === 'breached') return 'degraded';
  if (status === 'unknown') return 'unknown';
  return 'healthy';
}

function serviceRow(s: ServiceSla, customerName: string, l: Linked) {
  const m = metrics(l, (r) => r.service_id === s.id);
  return { level: 'service', id: s.id, name: s.name, customer_id: s.customer_id, customer_name: customerName, criticality: s.criticality, sla_value: s.value, sla_target: s.sla_target, sla_status: s.sla_status, health: health(s.sla_status, m), ...m };
}

/** One row per service, used by the sortable customer/service table on the Overview. */
function portfolioRows(sla: CustomerSla[], l: Linked) {
  return sla.flatMap((c) => c.services.map((s) => serviceRow(s, c.name, l)));
}

/** Rows for one drill-down level: Customer -> Service -> System -> Object. */
export async function drillDown(db: Db, scope: Scope, f: OverviewFilters & { serviceId?: string; systemId?: string }, now = new Date()) {
  const period = resolvePeriod((f.period as PeriodKey) || 'current_month', now, f.from, f.to);
  if (f.customerId && narrowCustomers(scope, f.customerId).length === 0) throw notFound('Customer');
  const [requests, alarms, vulns, results, slaData] = await Promise.all([
    loadRows(db, scope, 'requests', f.customerId, now),
    loadRows(db, scope, 'alarms', f.customerId, now),
    loadRows(db, scope, 'vulnerabilities', f.customerId, now),
    loadRows(db, scope, 'hardening', f.customerId, now),
    loadSlaData(db, scope, f.customerId),
  ]);
  const sla = buildSla(slaData, period, now);
  const linked: Linked = { requests, alarms, vulns, results };
  const trail: { level: string; id: string; name: string }[] = [];
  const base = { period: periodInfo(period) };

  if (!f.customerId) {
    const rows = sla.map((c) => {
      const m = metrics(linked, (r) => r.customer_id === c.id);
      return { level: 'customer', id: c.id, name: c.name, customer_id: c.id, customer_name: c.name, criticality: null, sla_value: c.value, sla_target: c.sla_target, sla_status: c.sla_status, health: health(c.sla_status, m), ...m };
    });
    return { ...base, level: 'customer', trail, rows };
  }
  const customer = sla[0];
  trail.push({ level: 'customer', id: customer.id, name: customer.name });
  if (!f.serviceId) {
    return { ...base, level: 'service', trail, rows: customer.services.map((s) => serviceRow(s, customer.name, linked)) };
  }
  const service = customer.services.find((s) => s.id === f.serviceId);
  if (!service) throw notFound('Service');
  trail.push({ level: 'service', id: service.id, name: service.name });

  const objectRow = (o: ServiceSla['objects'][number]) => {
    const m = metrics(linked, (r) => r.object_id === o.id);
    return { level: 'object', id: o.id, name: o.name, customer_id: o.customer_id, customer_name: customer.name, criticality: null, os: o.os, sla_value: o.availability, sla_target: o.sla_target, sla_status: o.sla_status, current_status: o.current_status, health: health(o.sla_status, m), ...m };
  };

  if (!f.systemId) {
    const systems = new Map<string, ServiceSla['objects']>();
    for (const o of service.objects) systems.set(o.system_id, [...(systems.get(o.system_id) ?? []), o]);
    const rows = [...systems.entries()].map(([id, objects]) => {
      const m = metrics(linked, (r) => r.system_id === id);
      // Systems have no SLA of their own, so show the worst object rather than invent an average.
      const order: SlaStatus[] = ['unknown', 'breached', 'at_risk', 'met'];
      const worst = order.find((st) => objects.some((o) => o.sla_included && o.sla_status === st)) ?? 'unknown';
      const lowest = objects.filter((o) => o.sla_included && o.availability !== null).map((o) => o.availability!);
      return { level: 'system', id, name: objects[0].system_name, customer_id: customer.id, customer_name: customer.name, criticality: null, sla_value: worst === 'unknown' || lowest.length === 0 ? null : Math.min(...lowest), sla_target: service.sla_target, sla_status: worst, health: health(worst, m), ...m };
    });
    return { ...base, level: 'system', trail, rows };
  }
  const objects = service.objects.filter((o) => o.system_id === f.systemId);
  if (objects.length === 0) throw notFound('System');
  trail.push({ level: 'system', id: f.systemId, name: objects[0].system_name });
  return { ...base, level: 'object', trail, rows: objects.map(objectRow) };
}

export async function licenseSummary(db: Db, scope: Scope, customerId?: string, now = new Date()) {
  const rows = await loadRows(db, scope, 'licenses', customerId, now);
  const byCustomer = [...groupBy(rows, 'customer_id').entries()].map(([id, list]) => ({
    customer_id: id,
    customer_name: list[0].customer_name,
    shortfalls: list.filter((l) => l.state === 'potential_shortfall').length,
    renewals: list.filter((l) => l.renewal_upcoming).length,
    missing: list.filter((l) => l.state === 'missing_data').length,
    groups: summarizeLicenses(list as any),
  }));
  return {
    portfolio: summarizeLicenses(rows as any),
    customers: byCustomer,
    shortfalls: rows.filter((l) => l.state === 'potential_shortfall').length,
    renewals: rows.filter((l) => l.renewal_upcoming).length,
    missing: rows.filter((l) => l.state === 'missing_data').length,
  };
}

export async function hardeningSummary(db: Db, scope: Scope, f: { customerId?: string; serviceId?: string; systemId?: string; objectId?: string; os?: string; groupBy?: string }, now = new Date()) {
  let rows = await loadRows(db, scope, 'hardening', f.customerId, now);
  if (f.serviceId) rows = rows.filter((r) => r.service_id === f.serviceId);
  if (f.systemId) rows = rows.filter((r) => r.system_id === f.systemId);
  if (f.objectId) rows = rows.filter((r) => r.object_id === f.objectId);
  if (f.os) rows = rows.filter((r) => r.object_os === f.os);
  const level = ['customer', 'service', 'system', 'object'].includes(f.groupBy ?? '') ? f.groupBy! : 'customer';
  const summarize = (list: Row[]) => ({
    ...scoreHardening(tally(list.map((r) => r.result as ControlResult))),
    accepted_exceptions: list.filter((r) => r.acceptance_status === 'accepted').length,
    last_scan: list.reduce<string | null>((max, r) => {
      if (!r.scanned_at) return max;
      const iso = new Date(r.scanned_at).toISOString();
      return !max || iso > max ? iso : max;
    }, null),
  });
  const groups = [...groupBy(rows, `${level}_id`).entries()].map(([id, list]) => ({ id, name: list[0][`${level}_name`], customer_name: list[0].customer_name, ...summarize(list) }));

  // Trend sums the scan closest to each month end for each object in the filter.
  const objectIds = [...new Set(rows.map((r) => r.object_id))];
  const scans = objectIds.length ? await db.query<Row>('SELECT * FROM hardening_scans WHERE object_id = ANY($1::text[]) ORDER BY scanned_at', [objectIds]) : [];
  const buckets = new Map<string, Row[]>();
  for (const s of scans) {
    const label = new Date(s.scanned_at).toISOString().slice(0, 7);
    buckets.set(label, [...(buckets.get(label) ?? []), s]);
  }
  const trend = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, list]) => {
    const t = emptyTally();
    const latestByObject = new Map<string, Row>();
    for (const s of list) latestByObject.set(s.object_id, s);
    for (const s of latestByObject.values()) {
      t.passed += s.passed; t.failed += s.failed; t.warning += s.warning; t.not_applicable += s.not_applicable; t.not_checked += s.not_checked;
    }
    const score = scoreHardening(t);
    return { label, score: score.score, denominator: score.denominator, objects: latestByObject.size };
  });
  return { formula: 'Passed / (Passed + Failed + Warning). Not applicable is excluded. Not checked is a coverage gap. Accepted risk does not change the score.', total: summarize(rows), groups: groups.sort((a, b) => (a.score ?? -1) - (b.score ?? -1)), trend };
}
