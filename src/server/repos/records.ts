import type { Db } from '../db/db';
import { narrowCustomers, type Scope } from '../auth';
import { evaluateLifecycle } from '../../domain/lifecycle';
import { evaluateLicense, type LicenseInput } from '../../domain/license';
import { isEffective, riskBuckets } from '../../domain/riskStateMachine';
import { resolvePeriod, type PeriodKey } from '../../domain/periods';
import { notFound } from '../errors';

export interface ListParams {
  customerId?: string;
  serviceId?: string;
  systemId?: string;
  objectId?: string;
  os?: string;
  severity?: string;
  status?: string;
  q?: string;
  mine?: string;
  period?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
  pageSize?: string;
  kind?: string;
  source?: string;
  bucket?: string;
  renewal?: string;
  result?: string;
}

type Row = Record<string, any>;

export interface EntityDef {
  table: string;
  label: string;
  hierarchy: boolean;
  assignee: boolean;
  dateField: string | null;
  defaultSort: string;
  extraSelect?: string;
  extraJoin?: string;
  search: string[];
  /** Field shown in the Status filter. */
  statusField: string;
  /** Terminal statuses, used for "open" filtering. */
  closed?: string[];
  decorate?: (db: Db, rows: Row[], now: Date) => Promise<Row[]> | Row[];
}

const decorateHardening = async (db: Db, rows: Row[]) => {
  if (rows.length === 0) return rows;
  const customers = [...new Set(rows.map((r) => r.customer_id))];
  const links = await db.query(
    `SELECT a.id, a.status, a.review_required, a.control_id, o.object_id, o.approved_scope
     FROM risk_acceptances a JOIN risk_acceptance_objects o ON o.acceptance_id = a.id
     WHERE a.customer_id = ANY($1::text[])`,
    [customers],
  );
  const index = new Map<string, Row[]>();
  for (const l of links) {
    const key = `${l.control_id}|${l.object_id}`;
    index.set(key, [...(index.get(key) ?? []), l]);
  }
  return rows.map((r) => {
    const history = index.get(`${r.control_id}|${r.object_id}`) ?? [];
    const covering = history.find((h) => isEffective(h as any) && h.approved_scope);
    const needsReview = history.find((h) => h.status === 'accepted' && (h.review_required || !h.approved_scope));
    const pending = history.find((h) => h.status === 'pending');
    return {
      ...r,
      acceptance_status: covering ? 'accepted' : needsReview ? 'review_required' : pending ? 'pending' : history.length ? 'none_active' : 'none',
      acceptance_id: covering?.id ?? needsReview?.id ?? pending?.id ?? null,
    };
  });
};

const decorateRisk = async (db: Db, rows: Row[], now: Date) => {
  if (rows.length === 0) return rows;
  const objs = await db.query(
    `SELECT l.acceptance_id, l.approved_scope, o.id, o.name, o.service_id, o.system_id, o.os
     FROM risk_acceptance_objects l JOIN objects o ON o.id = l.object_id
     WHERE l.acceptance_id = ANY($1::text[])`,
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => {
    const affected = objs.filter((o) => o.acceptance_id === r.id);
    return {
      ...r,
      affected_objects: affected.map((o) => ({ id: o.id, name: o.name, approved_scope: o.approved_scope })),
      affected_names: affected.map((o) => o.name).join(', '),
      service_ids: affected.map((o) => o.service_id),
      system_ids: affected.map((o) => o.system_id),
      object_ids: affected.map((o) => o.id),
      object_oses: affected.map((o) => o.os),
      buckets: riskBuckets(r as any, now),
      effective: isEffective(r as any),
    };
  });
};

export const ENTITIES: Record<string, EntityDef> = {
  requests: {
    table: 'requests_incidents', label: 'Request or incident', hierarchy: true, assignee: true, dateField: 'opened_at', defaultSort: 'opened_at',
    search: ['id', 'title', 'description'], statusField: 'status', closed: ['resolved', 'closed'],
  },
  projects: {
    table: 'projects', label: 'Project', hierarchy: true, assignee: true, dateField: 'opened_at', defaultSort: 'updated_at',
    search: ['id', 'title', 'description'], statusField: 'status', closed: ['done'],
  },
  tasks: {
    table: 'tasks', label: 'Task', hierarchy: true, assignee: true, dateField: 'opened_at', defaultSort: 'updated_at',
    search: ['id', 'title', 'description'], statusField: 'status', closed: ['done', 'closed'],
    extraSelect: 'p.title AS project_title', extraJoin: 'LEFT JOIN projects p ON p.id = t.project_id',
  },
  activities: {
    table: 'gitlab_activities', label: 'GitLab activity', hierarchy: true, assignee: true, dateField: 'opened_at', defaultSort: 'opened_at',
    search: ['id', 'title', 'description'], statusField: 'status',
  },
  alarms: {
    table: 'alarms', label: 'Alarm', hierarchy: true, assignee: true, dateField: 'opened_at', defaultSort: 'opened_at',
    search: ['id', 'title', 'description'], statusField: 'status', closed: ['resolved'],
  },
  vulnerabilities: {
    table: 'vulnerabilities', label: 'Vulnerability', hierarchy: true, assignee: true, dateField: 'opened_at', defaultSort: 'cvss',
    search: ['id', 'cve', 'title', 'description'], statusField: 'status', closed: ['resolved'],
  },
  hardening: {
    table: 'control_results', label: 'Control result', hierarchy: true, assignee: false, dateField: null, defaultSort: 'severity_rank',
    extraSelect: `ct.code AS control_code, ct.title AS title, ct.description AS description, ct.version AS control_version,
      ct.severity AS severity, ct.remediation AS remediation, ct.baseline_id AS baseline_id, b.name AS baseline_name, b.version AS baseline_version,
      CASE ct.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END AS severity_rank`,
    extraJoin: 'JOIN controls ct ON ct.id = t.control_id JOIN baselines b ON b.id = ct.baseline_id',
    search: ['id', 'control_code', 'title', 'object_name'], statusField: 'result',
    decorate: (db, rows) => decorateHardening(db, rows),
  },
  lifecycle: {
    table: 'lifecycle_records', label: 'Lifecycle record', hierarchy: true, assignee: false, dateField: null, defaultSort: 'days_remaining',
    search: ['id', 'product', 'version', 'vendor', 'owner', 'object_name'], statusField: 'status',
    decorate: (_db, rows, now) =>
      rows.map((r) => {
        const peers = rows.filter((p) => p.customer_id === r.customer_id && p.product === r.product && p.version === r.version);
        return {
          ...r,
          ...evaluateLifecycle(r as any, now),
          title: `${r.product} ${r.version}`,
          description: `${r.kind === 'os' ? 'Operating system' : 'Installed component'} from ${r.vendor}`,
          affected_objects: peers.map((p) => ({ id: p.object_id, name: p.object_name, record_id: p.id })),
          affected_count: peers.length,
        };
      }),
  },
  licenses: {
    table: 'licenses', label: 'License', hierarchy: false, assignee: false, dateField: null, defaultSort: 'days_to_renewal',
    search: ['id', 'product', 'edition', 'model', 'owner', 'contract_ref', 'contractual_scope'], statusField: 'state',
    decorate: (_db, rows, now) =>
      rows.map((r) => ({
        ...r,
        ...evaluateLicense(r as unknown as LicenseInput, now),
        title: `${r.product} ${r.edition}`,
        description: `${r.model}. Scope: ${r.contractual_scope}.`,
      })),
  },
  risk: {
    table: 'risk_acceptances', label: 'Risk acceptance', hierarchy: false, assignee: false, dateField: null, defaultSort: 'updated_at',
    search: ['id', 'title', 'justification', 'affected_names'], statusField: 'status',
    extraSelect: `owner.name AS risk_owner_name, appr.name AS approver_name, req.name AS requester_name, dec.name AS decision_by_name,
      ct.code AS control_code, ct.version AS current_control_version, ct.remediation AS remediation, b.name AS baseline_name`,
    extraJoin: `JOIN users owner ON owner.id = t.risk_owner_id JOIN users appr ON appr.id = t.approver_id
      JOIN users req ON req.id = t.requester_id LEFT JOIN users dec ON dec.id = t.decision_by
      JOIN controls ct ON ct.id = t.control_id JOIN baselines b ON b.id = t.baseline_id`,
    decorate: decorateRisk,
  },
};

function baseSql(def: EntityDef): string {
  const select = ['t.*', 'c.name AS customer_name', 'c.code AS customer_code'];
  const joins = ['JOIN customers c ON c.id = t.customer_id'];
  if (def.hierarchy) {
    select.push('s.name AS service_name', 's.criticality AS service_criticality', 'sy.name AS system_name', 'o.name AS object_name', 'o.os AS object_os');
    joins.push('LEFT JOIN services s ON s.id = t.service_id', 'LEFT JOIN systems sy ON sy.id = t.system_id', 'LEFT JOIN objects o ON o.id = t.object_id');
  }
  if (def.assignee) {
    select.push('u.name AS assignee_name');
    joins.push('LEFT JOIN users u ON u.id = t.assignee_id');
  }
  if (def.extraSelect) select.push(def.extraSelect);
  if (def.extraJoin) joins.push(def.extraJoin);
  return `SELECT ${select.join(', ')} FROM ${def.table} t ${joins.join(' ')}`;
}

/** Loads every decorated row in scope. Scope is a required argument, and it is applied in SQL. */
export async function loadRows(db: Db, scope: Scope, entity: string, customerId?: string, now = new Date()): Promise<Row[]> {
  const def = ENTITIES[entity];
  if (!def) throw notFound('Record type');
  const ids = narrowCustomers(scope, customerId);
  if (ids.length === 0) return [];
  const rows = await db.query<Row>(`${baseSql(def)} WHERE t.customer_id = ANY($1::text[])`, [ids]);
  return def.decorate ? def.decorate(db, rows, now) : rows;
}

function matchesHierarchy(def: EntityDef, row: Row, p: ListParams): boolean {
  if (def.table === 'risk_acceptances') {
    if (p.serviceId && !row.service_ids.includes(p.serviceId)) return false;
    if (p.systemId && !row.system_ids.includes(p.systemId)) return false;
    if (p.objectId && !row.object_ids.includes(p.objectId)) return false;
    if (p.os && !row.object_oses.includes(p.os)) return false;
    return true;
  }
  if (!def.hierarchy) return true;
  if (p.serviceId && row.service_id !== p.serviceId) return false;
  if (p.systemId && row.system_id !== p.systemId) return false;
  if (p.objectId && row.object_id !== p.objectId) return false;
  if (p.os && row.object_os !== p.os) return false;
  return true;
}

function compare(a: unknown, b: unknown): number {
  const missingA = a === null || a === undefined;
  const missingB = b === null || b === undefined;
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

const RANKED_FIELDS = ['severity', 'priority', 'residual_risk'];
const RANK: Record<string, number> = { low: 1, medium: 2, warning: 2.5, high: 3, critical: 4 };

const countBy = (rows: Row[], field: string) => {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const v = r[field];
    if (v !== null && v !== undefined) counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
};

export interface ListResult {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  facets: { status: Record<string, number>; severity: Record<string, number> };
  periodInfo: { label: string; start: string; end: string; timezone: string } | null;
}

export async function listEntity(db: Db, scope: Scope, entity: string, p: ListParams, now = new Date()): Promise<ListResult> {
  const def = ENTITIES[entity];
  if (!def) throw notFound('Record type');
  let rows = await loadRows(db, scope, entity, p.customerId, now);
  rows = rows.filter((r) => matchesHierarchy(def, r, p));

  let periodInfo: ListResult['periodInfo'] = null;
  if (p.period && def.dateField) {
    const period = resolvePeriod(p.period as PeriodKey, now, p.from, p.to);
    periodInfo = { label: period.label, start: period.start.toISOString(), end: period.end.toISOString(), timezone: period.timezone };
    rows = rows.filter((r) => {
      const t = new Date(r[def.dateField!]).getTime();
      return t >= period.start.getTime() && t < period.end.getTime();
    });
  }
  if (p.mine === 'true' && def.assignee) rows = rows.filter((r) => r.assignee_id === scope.userId);
  if (p.kind) rows = rows.filter((r) => r.kind === p.kind);
  if (p.source) rows = rows.filter((r) => r.source === p.source);
  if (p.q) {
    const needle = p.q.toLowerCase();
    rows = rows.filter((r) => def.search.some((f) => String(r[f] ?? '').toLowerCase().includes(needle)));
  }

  if (p.bucket) rows = rows.filter((r) => (r.buckets ?? []).includes(p.bucket));
  if (p.renewal === 'upcoming') rows = rows.filter((r) => r.renewal_upcoming);

  const matchesStatus = (r: Row) => (p.status === 'open' ? !(def.closed ?? []).includes(r[def.statusField]) : !p.status || r[def.statusField] === p.status);
  const matchesSeverity = (r: Row) => !p.severity || r.severity === p.severity;

  // Each facet counts what choosing that option would return, given the other filters.
  // Rows are already scoped, so the counts cannot reveal other customers.
  const facets = { status: countBy(rows.filter(matchesSeverity), def.statusField), severity: countBy(rows.filter(matchesStatus), 'severity') };

  rows = rows.filter((r) => matchesStatus(r) && matchesSeverity(r));

  const sort = p.sort || def.defaultSort;
  const dir = p.dir === 'asc' || p.dir === 'desc' ? p.dir : def.defaultSort === 'days_remaining' || def.defaultSort === 'days_to_renewal' ? 'asc' : 'desc';
  const sign = dir === 'asc' ? 1 : -1;
  const sortValue = (r: Row) => (RANKED_FIELDS.includes(sort) ? (RANK[r[sort]] ?? r[sort]) : r[sort]);
  rows = [...rows].sort((a, b) => {
    const x = sortValue(a);
    const y = sortValue(b);
    if (x === null || x === undefined || y === null || y === undefined) return compare(x, y);
    return sign * compare(x, y);
  });

  const total = rows.length;
  const pageSize = Math.min(Math.max(Number(p.pageSize) || 25, 1), 500);
  const page = Math.max(Number(p.page) || 1, 1);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, facets, periodInfo };
}

/** Fetches one record. A record outside the session's scope behaves as if it does not exist. */
export async function getEntity(db: Db, scope: Scope, entity: string, id: string, now = new Date()): Promise<Row> {
  const def = ENTITIES[entity];
  if (!def) throw notFound('Record type');
  if (scope.customerIds.length === 0) throw notFound(def.label);
  const rows = await db.query<Row>(`${baseSql(def)} WHERE t.id = $1 AND t.customer_id = ANY($2::text[])`, [id, [...scope.customerIds]]);
  if (!rows[0]) throw notFound(def.label);
  if (!def.decorate) return rows[0];
  // Lifecycle peers need the customer's other rows, so decorate over all of them.
  if (entity === 'lifecycle') {
    const all = await loadRows(db, scope, entity, rows[0].customer_id, now);
    return all.find((r) => r.id === id)!;
  }
  return (await def.decorate(db, rows, now))[0];
}

/** Open records that share an object or service with the given record. */
export async function relatedRecords(db: Db, scope: Scope, record: Row): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  if (!record.service_id && !record.object_id) return out;
  for (const entity of ['requests', 'alarms', 'vulnerabilities', 'tasks', 'hardening', 'lifecycle']) {
    const rows = await loadRows(db, scope, entity, record.customer_id);
    const def = ENTITIES[entity];
    const sameObject = (r: Row) => record.object_id && r.object_id === record.object_id;
    const sameService = (r: Row) => !record.object_id && record.service_id && r.service_id === record.service_id;
    let linked = rows.filter((r) => (sameObject(r) || sameService(r)) && r.id !== record.id && !(def.closed ?? []).includes(r[def.statusField]));
    if (entity === 'hardening') linked = linked.filter((r) => r.result === 'failed' || r.result === 'warning');
    if (linked.length) {
      out[entity] = linked.slice(0, 5).map((r) => ({ id: r.id, title: r.title, status: r[def.statusField], severity: r.severity ?? r.priority ?? null }));
    }
  }
  return out;
}

export async function filterOptions(db: Db, scope: Scope) {
  const ids = [...scope.customerIds];
  if (ids.length === 0) return { customers: [], services: [], systems: [], objects: [], os: [] };
  const [customers, services, systems, objects] = await Promise.all([
    db.query('SELECT id, name, code FROM customers WHERE id = ANY($1::text[]) ORDER BY name', [ids]),
    db.query('SELECT id, name, customer_id FROM services WHERE customer_id = ANY($1::text[]) ORDER BY name', [ids]),
    db.query('SELECT id, name, customer_id, service_id FROM systems WHERE customer_id = ANY($1::text[]) ORDER BY name', [ids]),
    db.query('SELECT id, name, customer_id, service_id, system_id, os FROM objects WHERE customer_id = ANY($1::text[]) ORDER BY name', [ids]),
  ]);
  return { customers, services, systems, objects, os: [...new Set(objects.map((o: Row) => o.os))].sort() };
}
