import type { Db } from '../db/db';
import { narrowCustomers, type Scope } from '../auth';
import { computeAvailability, type AvailabilityResult, type Interval } from '../../domain/availability';
import { aggregateSla, slaStatus, type SlaAggregate, type SlaStatus } from '../../domain/sla';
import { trailingMonths, type Period } from '../../domain/periods';

type Row = Record<string, any>;

export interface SlaData {
  customers: Row[];
  services: Row[];
  objects: Row[];
  coverage: Map<string, Interval[]>;
  outages: Map<string, Interval[]>;
  rawOutages: Map<string, Row[]>;
  maintenance: Map<string, Interval[]>;
}

const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export async function loadSlaData(db: Db, scope: Scope, customerId?: string): Promise<SlaData> {
  const ids = narrowCustomers(scope, customerId);
  const empty: SlaData = { customers: [], services: [], objects: [], coverage: new Map(), outages: new Map(), rawOutages: new Map(), maintenance: new Map() };
  if (ids.length === 0) return empty;
  const [customers, services, objects, coverage, outages, maintenance] = await Promise.all([
    db.query('SELECT * FROM customers WHERE id = ANY($1::text[]) ORDER BY name', [ids]),
    db.query('SELECT * FROM services WHERE customer_id = ANY($1::text[]) ORDER BY name', [ids]),
    db.query(`SELECT o.*, sy.name AS system_name FROM objects o JOIN systems sy ON sy.id = o.system_id WHERE o.customer_id = ANY($1::text[]) ORDER BY o.name`, [ids]),
    db.query('SELECT * FROM monitoring_coverage WHERE customer_id = ANY($1::text[])', [ids]),
    db.query('SELECT * FROM outages WHERE customer_id = ANY($1::text[])', [ids]),
    db.query('SELECT * FROM maintenance_windows WHERE customer_id = ANY($1::text[])', [ids]),
  ]);
  const data: SlaData = { ...empty, coverage: new Map(), outages: new Map(), rawOutages: new Map(), maintenance: new Map(), customers, services, objects };
  const nowMs = Date.now();
  const interval = (r: Row): Interval => ({ start: new Date(r.started_at).getTime(), end: r.ended_at ? new Date(r.ended_at).getTime() : nowMs });
  for (const r of coverage) push(data.coverage, r.object_id, interval(r));
  for (const r of outages) {
    push(data.outages, r.object_id, interval(r));
    push(data.rawOutages, r.object_id, r);
  }
  for (const r of maintenance) push(data.maintenance, r.object_id, interval(r));
  return data;
}

export interface ObjectSla extends AvailabilityResult {
  id: string;
  name: string;
  customer_id: string;
  service_id: string;
  system_id: string;
  system_name: string;
  os: string;
  object_type: string;
  sla_target: number;
  sla_weight: number;
  sla_included: boolean;
  sla_status: SlaStatus;
  current_status: 'up' | 'down' | 'maintenance' | 'unknown';
  last_outage_at: string | null;
}

export interface ServiceSla {
  id: string;
  name: string;
  customer_id: string;
  criticality: string;
  sla_target: number;
  sla_weight: number;
  sla_included: boolean;
  value: number | null;
  sla_status: SlaStatus;
  aggregate: SlaAggregate;
  objects: ObjectSla[];
  downtime_counted_ms: number;
  planned_ms: number;
}

export interface CustomerSla {
  id: string;
  name: string;
  sla_target: number;
  exclude_planned_maintenance: boolean;
  value: number | null;
  sla_status: SlaStatus;
  aggregate: SlaAggregate;
  services: ServiceSla[];
}

export function buildSla(data: SlaData, period: Period, now: Date): CustomerSla[] {
  const nowMs = now.getTime();
  const currentStatus = (id: string): ObjectSla['current_status'] => {
    const covered = (data.coverage.get(id) ?? []).some((i) => i.start <= nowMs && i.end >= nowMs);
    if (!covered) return 'unknown';
    if ((data.rawOutages.get(id) ?? []).some((o) => !o.ended_at)) return 'down';
    if ((data.maintenance.get(id) ?? []).some((i) => i.start <= nowMs && i.end > nowMs)) return 'maintenance';
    return 'up';
  };

  return data.customers.map((c) => {
    const services: ServiceSla[] = data.services
      .filter((s) => s.customer_id === c.id)
      .map((s) => {
        const objects: ObjectSla[] = data.objects
          .filter((o) => o.service_id === s.id)
          .map((o) => {
            const result = computeAvailability({
              start: period.start.getTime(),
              end: period.end.getTime(),
              now: nowMs,
              coverage: data.coverage.get(o.id) ?? [],
              outages: data.outages.get(o.id) ?? [],
              maintenance: data.maintenance.get(o.id) ?? [],
              excludeMaintenance: c.exclude_planned_maintenance,
            });
            const last = (data.rawOutages.get(o.id) ?? [])
              .map((r) => new Date(r.started_at).getTime())
              .filter((t) => t <= nowMs)
              .sort((a, b) => b - a)[0];
            return {
              ...result,
              id: o.id, name: o.name, customer_id: o.customer_id, service_id: o.service_id, system_id: o.system_id,
              system_name: o.system_name, os: o.os, object_type: o.object_type,
              sla_target: o.sla_target, sla_weight: o.sla_weight, sla_included: o.sla_included,
              sla_status: slaStatus(result.availability, o.sla_target),
              current_status: currentStatus(o.id),
              last_outage_at: last ? new Date(last).toISOString() : null,
            };
          });
        const aggregate = aggregateSla(objects.map((o) => ({ id: o.id, name: o.name, weight: o.sla_weight, included: o.sla_included, value: o.availability })));
        const included = objects.filter((o) => o.sla_included);
        return {
          id: s.id, name: s.name, customer_id: s.customer_id, criticality: s.criticality,
          sla_target: s.sla_target, sla_weight: s.sla_weight, sla_included: s.sla_included,
          value: aggregate.value, sla_status: slaStatus(aggregate.value, s.sla_target), aggregate, objects,
          downtime_counted_ms: included.reduce((sum, o) => sum + o.countedDowntimeMs, 0),
          planned_ms: included.reduce((sum, o) => sum + o.plannedDowntimeMs, 0),
        };
      });
    const aggregate = aggregateSla(services.map((s) => ({ id: s.id, name: s.name, weight: s.sla_weight, included: s.sla_included, value: s.value })));
    return {
      id: c.id, name: c.name, sla_target: c.sla_target, exclude_planned_maintenance: c.exclude_planned_maintenance,
      value: aggregate.value, sla_status: slaStatus(aggregate.value, c.sla_target), aggregate, services,
    };
  });
}

export interface HistoryPoint { label: string; value: number | null; target: number; status: SlaStatus }

export function slaHistory(data: SlaData, now: Date, level: 'customer' | 'service' | 'object', id: string, months = 12): HistoryPoint[] {
  return trailingMonths(now, months).map((period) => {
    const customers = buildSla(data, period, now);
    let value: number | null = null;
    let target = 0;
    let status: SlaStatus = 'unknown';
    for (const c of customers) {
      if (level === 'customer' && c.id === id) ({ value, sla_status: status, sla_target: target } = c);
      for (const s of c.services) {
        if (level === 'service' && s.id === id) ({ value, sla_status: status, sla_target: target } = s);
        for (const o of s.objects) {
          if (level === 'object' && o.id === id) {
            value = o.availability;
            status = o.sla_status;
            target = o.sla_target;
          }
        }
      }
    }
    return { label: period.label, value, target, status };
  });
}
