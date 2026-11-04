import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../lib/api';
import { fmtDateTime, fmtDuration, fmtPct } from '../lib/format';
import { AuditHistory } from './DetailDrawer';
import { Button, EmptyState, ErrorState, FieldList, Loader, Panel, Section, StatusBadge, Unavailable } from './ui';

export function AvailabilityChart({ level, id, name }: { level: string; id: string; name: string }) {
  const query = useQuery<any[]>({ queryKey: ['sla-history', level, id], queryFn: () => api.get(`/api/sla/history${qs({ level, id })}`) });
  const data = query.data ?? [];
  const known = data.filter((d) => d.value !== null).map((d) => d.value as number);
  const floor = known.length ? Math.floor(Math.min(...known, data[0]?.target ?? 100) * 10) / 10 - 0.1 : 99;
  return (
    <Panel title={`12-month availability: ${name}`}>
      {query.isLoading && <Loader />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && known.length === 0 && <EmptyState title="No availability history" hint="Monitoring data is missing for this period, so the result is Unknown." />}
      {query.data && known.length > 0 && (
        <>
          <div className="h-52 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ left: -6, right: 8, top: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                <YAxis domain={[floor, 100]} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(x) => Number(x).toFixed(2)} />
                <Tooltip contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 11 }} formatter={(value: any, label: any) => [value === null || value === undefined ? 'Unknown' : `${Number(value).toFixed(3)}%`, label]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line name="Availability" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                <Line name="Target" dataKey="target" stroke="var(--warn)" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {data.some((d) => d.value === null) && <p className="px-3 pb-2 text-[11px] text-muted">Gaps in the line are months with Unknown results. They are not shown as zero or 100%.</p>}
        </>
      )}
    </Panel>
  );
}

export function SlaSummary({ customers, onCalculation, onHistory }: { customers: any[]; onCalculation: (level: string, id: string) => void; onHistory: (level: string, id: string) => void }) {
  return (
    <div className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {customers.map((c) => (
        <div key={c.id} className="rounded border border-line bg-surface p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <strong>{c.name}</strong>
            <StatusBadge value={c.sla_status} />
          </div>
          <div className="num mt-0.5 text-xl font-semibold">{c.value === null ? <Unavailable>{c.aggregate.completeness === 'empty' ? 'Nothing included' : 'Incomplete'}</Unavailable> : fmtPct(c.value)}</div>
          <div className="num text-[11px] text-muted">Overall SLA, target {c.sla_target}%</div>
          {c.aggregate.completeness === 'incomplete' && <p className="num text-[11px] text-warn">{(c.aggregate.missingWeightShare * 100).toFixed(1)}% of the weight has no data. It was not redistributed.</p>}
          <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
            {c.services.map((s: any) => (
              <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="num">{s.value === null ? 'Unknown' : fmtPct(s.value)}</span>
                <StatusBadge value={s.sla_status} />
                <Button variant="ghost" onClick={() => onCalculation('service', s.id)} aria-label={`Calculation for ${s.name}`}>Calc</Button>
                <Button variant="ghost" onClick={() => onHistory('service', s.id)} aria-label={`History for ${s.name}`}>Trend</Button>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-1">
            <Button onClick={() => onCalculation('customer', c.id)}>Show calculation</Button>
            <Button onClick={() => onHistory('customer', c.id)}>Show trend</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function WeightRow({ member, kind, canEdit, onSaved }: { member: any; kind: 'service' | 'object'; canEdit: boolean; onSaved: () => void }) {
  const [weight, setWeight] = useState(String(member.weight));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/sla/config/${kind}/${member.id}`, body),
    onSuccess: onSaved,
  });
  const valid = Number(weight) > 0;
  useEffect(() => setWeight(String(member.weight)), [member.weight]);
  return (
    <tr className="border-b border-line/60">
      <td className="py-1 pr-2">{member.name}</td>
      <td className="pr-2">
        {canEdit ? (
          <label className="flex items-center gap-1"><input type="checkbox" checked={member.included} disabled={save.isPending} onChange={(e) => save.mutate({ included: e.target.checked })} /> {member.included ? 'Included' : 'Excluded'}</label>
        ) : member.included ? 'Included' : 'Excluded'}
      </td>
      <td className="pr-2 text-right">
        {canEdit ? (
          <span className="inline-flex flex-col items-end">
            <label>
              <span className="sr-only">Weight for {member.name}</span>
              <input
                type="number" min="0.01" step="any" value={weight} aria-invalid={!valid} className="w-16 text-right"
                onChange={(e) => setWeight(e.target.value)}
                onBlur={() => { if (valid && Number(weight) !== member.weight) save.mutate({ weight: Number(weight) }); }}
              />
            </label>
            {!valid && <span role="alert" className="text-[11px] text-bad">Must be positive</span>}
          </span>
        ) : member.weight}
        {save.isError && <span role="alert" className="block text-[11px] text-bad">{(save.error as Error).message}</span>}
      </td>
      <td className="pr-2 text-right">{member.normalizedWeight === null ? '-' : `${(member.normalizedWeight * 100).toFixed(2)}%`}</td>
      <td className="pr-2 text-right">{member.value === null ? <Unavailable /> : fmtPct(member.value, 4)}</td>
      <td className="text-right">{member.contribution === null ? (member.included ? <Unavailable>Missing</Unavailable> : '-') : member.contribution.toFixed(4)}</td>
    </tr>
  );
}

function ContributionTable({ aggregate, kind, canEdit, onSaved, label }: { aggregate: any; kind: 'service' | 'object'; canEdit: boolean; onSaved: () => void; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-left text-xs">
        <thead className="text-[11px] uppercase text-muted">
          <tr>
            <th className="pb-1 font-medium">{label}</th><th className="font-medium">Inclusion</th><th className="text-right font-medium">Weight</th><th className="text-right font-medium">Normalized</th><th className="text-right font-medium">Value</th><th className="text-right font-medium">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {aggregate.contributions.map((m: any) => <WeightRow key={m.id} member={m} kind={kind} canEdit={canEdit} onSaved={onSaved} />)}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="pt-1" colSpan={3}>Result</td>
            <td className="pt-1 text-right">{(aggregate.knownWeightShare * 100).toFixed(2)}% known</td>
            <td />
            <td className="pt-1 text-right">{aggregate.value === null ? <Unavailable>{aggregate.completeness === 'empty' ? 'Nothing included' : 'Incomplete'}</Unavailable> : `${aggregate.value.toFixed(4)}%`}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function maintenanceText(excluded: boolean) {
  return excluded
    ? 'Planned maintenance is excluded. It leaves both the eligible monitored duration and the counted downtime.'
    : 'Planned maintenance counts as downtime, and the time stays in the eligible monitored duration.';
}

/** The full working behind one SLA result. */
export function SlaCalculation({ level, id, customers, period, canEdit }: { level: string; id: string; customers: any[]; period: any; canEdit: boolean }) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['sla'] });
    void client.invalidateQueries({ queryKey: ['sla-history'] });
    void client.invalidateQueries({ queryKey: ['sla-audit'] });
    void client.invalidateQueries({ queryKey: ['overview'] });
  };
  const maintenance = useMutation({
    mutationFn: ({ customerId, value }: { customerId: string; value: boolean }) => api.put(`/api/sla/config/customer/${customerId}`, { exclude_planned_maintenance: value }),
    onSuccess: refresh,
  });

  const customer = customers.find((c) => c.id === id || c.services.some((s: any) => s.id === id || s.objects.some((o: any) => o.id === id)));
  const audit = useQuery<any[]>({ queryKey: ['sla-audit', customer?.id], queryFn: () => api.get(`/api/audit${qs({ entity: 'sla_config', customerId: customer.id })}`), enabled: !!customer });
  if (!customer) return <EmptyState title="This result is not in the current filter" />;

  const header: [string, React.ReactNode][] = [['Reporting period', `${period.label} (${period.timezone}), ${fmtDateTime(period.start)} up to ${fmtDateTime(period.end)}, capped at the current time`]];
  const rule = (
    <Section title="Maintenance rule">
      <p>{maintenanceText(customer.exclude_planned_maintenance)}</p>
      {canEdit && (
        <label className="mt-1 flex items-center gap-1">
          <input type="checkbox" checked={customer.exclude_planned_maintenance} disabled={maintenance.isPending} onChange={(e) => maintenance.mutate({ customerId: customer.id, value: e.target.checked })} />
          Exclude planned maintenance for {customer.name}
        </label>
      )}
      {maintenance.isError && <ErrorState error={maintenance.error} />}
    </Section>
  );
  const history = audit.data && audit.data.length > 0 && <AuditHistory audit={audit.data} title="SLA configuration changes" />;

  if (level === 'customer') {
    return (
      <>
        <FieldList items={[...header, ['Formula', 'Customer Overall SLA = sum of (normalized weight x service SLA) over included services'], ['Target', `${customer.sla_target}%`], ['Status', <StatusBadge value={customer.sla_status} />]]} />
        <Section title="Services, weights and contributions">
          <ContributionTable aggregate={customer.aggregate} kind="service" canEdit={canEdit} onSaved={refresh} label="Service" />
          {customer.aggregate.completeness === 'incomplete' && <p className="mt-1 text-warn">Aggregation is incomplete. Unknown services keep their share of the weight, so no overall result is stated.</p>}
        </Section>
        <Section title="Downtime and data coverage by service">
          <table className="num w-full text-left">
            <thead className="text-[11px] uppercase text-muted"><tr><th className="font-medium">Service</th><th className="text-right font-medium">Counted downtime</th><th className="text-right font-medium">Planned</th><th className="text-right font-medium">Objects with data</th></tr></thead>
            <tbody>
              {customer.services.map((s: any) => {
                const included = s.objects.filter((o: any) => o.sla_included);
                return (
                  <tr key={s.id}><td>{s.name}</td><td className="text-right">{fmtDuration(s.downtime_counted_ms)}</td><td className="text-right">{fmtDuration(s.planned_ms)}</td><td className="text-right">{included.filter((o: any) => o.availability !== null).length} of {included.length}</td></tr>
                );
              })}
            </tbody>
          </table>
        </Section>
        {rule}
        {history}
      </>
    );
  }

  const service = customer.services.find((s: any) => s.id === id);
  if (level === 'service' && service) {
    return (
      <>
        <FieldList items={[...header, ['Formula', 'Service SLA = sum of (normalized weight x object availability) over included objects'], ['Target', `${service.sla_target}%`], ['Status', <StatusBadge value={service.sla_status} />], ['Counted downtime', fmtDuration(service.downtime_counted_ms)], ['Planned downtime', fmtDuration(service.planned_ms)]]} />
        <Section title="Objects, weights and contributions">
          <ContributionTable aggregate={service.aggregate} kind="object" canEdit={canEdit} onSaved={refresh} label="Object" />
          {service.aggregate.completeness === 'incomplete' && <p className="mt-1 text-warn">Aggregation is incomplete. Unknown objects keep their share of the weight, so no service result is stated.</p>}
        </Section>
        {rule}
        {history}
      </>
    );
  }

  const object = customer.services.flatMap((s: any) => s.objects).find((o: any) => o.id === id);
  if (!object) return <EmptyState title="This result is not in the current filter" />;
  return (
    <>
      <FieldList
        items={[
          ...header,
          ['Formula', 'Availability = (eligible monitored duration - counted downtime) / eligible monitored duration x 100'],
          ['Reporting time so far', fmtDuration(object.reportingMs)],
          ['Monitored', fmtDuration(object.monitoredMs)],
          ['Data coverage', `${(object.dataCoverage * 100).toFixed(2)}%`],
          ['Eligible monitored duration', `${fmtDuration(object.eligibleMs)} (${object.eligibleMs} ms)`],
          ['Counted downtime', `${fmtDuration(object.countedDowntimeMs)} (${object.countedDowntimeMs} ms)`],
          ['Planned downtime', fmtDuration(object.plannedDowntimeMs)],
          ['Unplanned downtime', fmtDuration(object.unplannedDowntimeMs)],
          ['Outages (overlaps merged)', object.outageCount],
          ['Last outage', object.last_outage_at ? fmtDateTime(object.last_outage_at) : 'None recorded'],
          ['Result', object.availability === null ? <Unavailable>{`Unknown: ${object.unknownReason}`}</Unavailable> : fmtPct(object.availability, 4)],
          ['Target', `${object.sla_target}%`],
          ['Status', <StatusBadge value={object.sla_status} />],
          ['Included in service SLA', object.sla_included ? `Yes, weight ${object.sla_weight}` : 'No'],
        ]}
      />
      {rule}
      {history}
    </>
  );
}
