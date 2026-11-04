import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtPct, humanize } from '../lib/format';
import { useCarry, useFilters } from '../lib/hooks';
import { DetailDrawer, ENTITY_PATH } from '../components/DetailDrawer';
import { FilterBar } from '../components/FilterBar';
import { PortfolioTable } from '../components/PortfolioTable';
import { EmptyState, ErrorState, FieldList, KpiCard, Loader, PageHeader, Panel, Section, StatusBadge, Unavailable } from '../components/ui';

export function OverviewView() {
  const filters = useFilters('overview');
  const carry = useCarry();
  const navigate = useNavigate();
  const v = filters.values;
  const [selected, setSelected] = useState<any>(null);
  const params = { customerId: v.customerId, period: v.period, from: v.from, to: v.to };
  const query = useQuery({ queryKey: ['overview', params], queryFn: () => api.get(`/api/overview${qs(params)}`), enabled: filters.ready });

  const d = query.data;
  const k = d?.kpis;
  const single = k?.sla.customers.length === 1 ? k.sla.customers[0] : null;

  return (
    <>
      <PageHeader title="Overview" description={d ? `SLA reporting period: ${d.period.label} (${d.period.timezone}). Other figures show the current state.` : undefined} />
      <FilterBar filters={filters} viewKey="overview" fields={['period']} periodRequired />
      {query.isLoading && <Loader />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {k && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="My open requests" value={k.myRequests} sub={`${k.openRequests} open in scope`} to={carry('/requests', { kind: 'request', status: 'open', mine: 'true' })} />
            <KpiCard label="Open incidents" value={k.openIncidents} sub={`${k.criticalIncidents} critical`} tone={k.criticalIncidents ? 'bad' : 'default'} to={carry('/requests', { kind: 'incident', status: 'open' })} />
            <KpiCard label="Projects and tasks" value={`${k.activeProjects} / ${k.openTasks}`} sub="Active projects / open tasks" to={carry('/projects', { tab: 'tasks', status: 'open' })} />
            <KpiCard label="Alarms" value={`${k.criticalAlarms} / ${k.warningAlarms}`} sub="Critical / warning" tone={k.criticalAlarms ? 'bad' : k.warningAlarms ? 'warn' : 'default'} to={carry('/alarms', { status: 'open', severity: 'critical' })} />
            <KpiCard label="Critical vulnerabilities" value={k.criticalVulnerabilities} sub="Open or being mitigated" tone={k.criticalVulnerabilities ? 'bad' : 'default'} to={carry('/vulnerabilities', { severity: 'critical', status: 'open' })} />
            <KpiCard
              label="Hardening compliance"
              value={k.hardening.score === null ? <Unavailable>No evaluated controls</Unavailable> : `${k.hardening.score.toFixed(1)}%`}
              sub={`${k.hardening.denominator} evaluated, ${k.hardening.notChecked} not checked, ${k.hardening.acceptedExceptions} accepted exceptions`}
              to={carry('/hardening')}
            />
            <KpiCard
              label="Availability and SLA"
              tone={k.sla.breached ? 'bad' : k.sla.atRisk ? 'warn' : k.sla.unknown ? 'unknown' : 'ok'}
              value={single ? (single.value === null ? <Unavailable /> : fmtPct(single.value)) : `${k.sla.met} of ${k.sla.customers.length} met`}
              sub={single ? `Target ${single.target}%, ${humanize(single.status)}` : `${k.sla.atRisk} at risk, ${k.sla.breached} breached, ${k.sla.unknown} unknown`}
              to={carry('/availability')}
            />
            <KpiCard label="Lifecycle deadlines" value={`${k.lifecycle.unsupported} / ${k.lifecycle.approaching}`} sub={`Unsupported / approaching, ${k.lifecycle.unknown} unknown`} tone={k.lifecycle.unsupported ? 'bad' : k.lifecycle.approaching ? 'warn' : 'default'} to={carry('/lifecycle', { status: 'unsupported' })} />
            <KpiCard label="License attention" value={`${k.licenses.shortfalls} / ${k.licenses.renewals}`} sub={`Potential shortfalls / renewals, ${k.licenses.missing} unmeasured`} tone={k.licenses.shortfalls ? 'warn' : 'default'} to={carry('/licenses', { status: 'potential_shortfall' })} />
            <KpiCard label="Risk acceptances" value={`${k.risk.pending} / ${k.risk.expiring}`} sub={`Pending / expiring, ${k.risk.reviewRequired} need review`} tone={k.risk.reviewRequired ? 'warn' : 'default'} to={carry('/risk-acceptances', { bucket: 'pending' })} />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Panel title="Attention list">
              {d.attention.length === 0 && <EmptyState title="Nothing needs attention" />}
              <ol>
                {d.attention.map((item: any) => (
                  <li key={`${item.entity}-${item.id}`} className="border-b border-line/60">
                    <button type="button" onClick={() => setSelected(item)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-2">
                      <span className="num w-7 shrink-0 text-right font-semibold text-primary" title="Priority score">{item.score}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        <span className="block truncate text-[11px] text-muted">{item.reason} · {[item.customer_name, item.service_name, item.object_name].filter(Boolean).join(' / ')}</span>
                      </span>
                      <StatusBadge value={item.severity} />
                    </button>
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel title="Customer and service portfolio">
              <PortfolioTable rows={d.portfolio} showCustomer onSelect={(r) => navigate(`/portfolio${qs({ customerId: r.customer_id, serviceId: r.id, period: v.period, from: v.from, to: v.to })}`)} />
            </Panel>
          </div>
        </>
      )}
      <DetailDrawer open={!!selected} onClose={() => setSelected(null)} title={selected?.title} subtitle={selected ? `${selected.customer_name} · ${selected.id}` : undefined}>
        {selected && (
          <>
            <FieldList items={[['Why it is listed', selected.reason], ['Service', selected.service_name ?? 'No linked service'], ['Object', selected.object_name ?? 'No linked object'], ['Severity', <StatusBadge value={selected.severity} />]]} />
            <Section title={`Priority score: ${selected.score}`}>
              <table className="num w-full text-left">
                <thead className="text-muted"><tr><th className="font-medium">Factor</th><th className="font-medium">Value</th><th className="text-right font-medium">Points</th></tr></thead>
                <tbody>
                  {selected.factors.map((f: any) => (
                    <tr key={f.factor}><td>{f.factor}</td><td>{humanize(f.value)}</td><td className="text-right">{f.points}</td></tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Link className="text-primary underline" to={(() => { const [path, extra] = ENTITY_PATH[selected.entity](selected.id); return `${path}${qs({ ...extra, customerId: selected.customer_id })}`; })()}>Open the record</Link>
          </>
        )}
      </DetailDrawer>
    </>
  );
}

export function PortfolioView() {
  const filters = useFilters('portfolio');
  const carry = useCarry();
  const v = filters.values;
  const [objectRow, setObjectRow] = useState<any>(null);
  const params = { customerId: v.customerId, serviceId: v.serviceId, systemId: v.systemId, period: v.period, from: v.from, to: v.to };
  const query = useQuery({ queryKey: ['portfolio', params], queryFn: () => api.get(`/api/portfolio${qs(params)}`), enabled: filters.ready });
  const data = query.data;

  const select = (row: any) => {
    if (row.level === 'customer') filters.set('customerId', row.id);
    else if (row.level === 'service') filters.set('serviceId', row.id);
    else if (row.level === 'system') filters.set('systemId', row.id);
    else setObjectRow(row);
  };
  const crumb = (level: string | null) => {
    if (!level) filters.setMany({ customerId: null, serviceId: null, systemId: null });
    if (level === 'customer') filters.setMany({ serviceId: null, systemId: null });
    if (level === 'service') filters.setMany({ systemId: null });
  };

  return (
    <>
      <PageHeader title="Portfolio" description="Drill down from customer to service, system and object. Availability uses the selected reporting period in UTC." />
      <FilterBar filters={filters} viewKey="portfolio" fields={['period']} periodRequired />
      <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        <button type="button" className="text-primary underline" onClick={() => crumb(null)}>All customers in scope</button>
        {data?.trail.map((t: any, i: number) => (
          <span key={t.id} className="flex items-center gap-1">
            <ChevronRight size={12} aria-hidden className="text-muted" />
            {i === data.trail.length - 1 ? <span aria-current="page" className="font-semibold">{t.name}</span> : <button type="button" className="text-primary underline" onClick={() => crumb(t.level)}>{t.name}</button>}
          </span>
        ))}
      </nav>
      <Panel title={data ? `${humanize(data.level)}s` : 'Portfolio'} actions={data && <span className="num text-[11px] text-muted">Period: {data.period.label} ({data.period.timezone})</span>}>
        {query.isLoading && <Loader />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {data && <PortfolioTable rows={data.rows} onSelect={select} nameLabel={humanize(data.level)} />}
      </Panel>
      <DetailDrawer open={!!objectRow} onClose={() => setObjectRow(null)} title={objectRow?.name} subtitle={objectRow?.customer_name}>
        {objectRow && (
          <>
            <FieldList items={[['Operating system', objectRow.os], ['Current status', <StatusBadge value={objectRow.current_status} />], ['Availability', objectRow.sla_value === null ? <Unavailable /> : fmtPct(objectRow.sla_value)], ['SLA target', `${objectRow.sla_target}%`], ['SLA status', <StatusBadge value={objectRow.sla_status} />], ['Hardening', objectRow.hardening_score === null ? <Unavailable>No evaluated controls</Unavailable> : `${objectRow.hardening_score.toFixed(1)}% of ${objectRow.hardening_denominator}`]]} />
            <Section title="Open records for this object">
              <div className="flex flex-wrap gap-1.5">
                {[['/requests', `Requests and incidents (${objectRow.open_requests + objectRow.open_incidents})`, { status: 'open' }], ['/alarms', `Alarms (${objectRow.critical_alarms + objectRow.warning_alarms})`, { status: 'open' }], ['/vulnerabilities', 'Vulnerabilities', { status: 'open' }], ['/hardening', 'Hardening', {}], ['/availability', 'Availability', {}], ['/lifecycle', 'Lifecycle', {}]].map(([path, label, extra]) => (
                  <Link key={path as string} className="rounded border border-line bg-surface-2 px-2 py-1 font-medium hover:border-primary" to={carry(path as string, { ...(extra as Record<string, string>), objectId: objectRow.id })}>{label as string}</Link>
                ))}
              </div>
            </Section>
          </>
        )}
      </DetailDrawer>
    </>
  );
}
