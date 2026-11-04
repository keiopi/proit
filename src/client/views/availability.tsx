import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { fmtDate, fmtDuration, fmtPct } from '../lib/format';
import { useFilters, useLocalSort, useMe } from '../lib/hooks';
import { Column, DataTable } from '../components/DataTable';
import { DetailDrawer } from '../components/DetailDrawer';
import { FilterBar } from '../components/FilterBar';
import { AvailabilityChart, SlaCalculation, SlaSummary } from '../components/sla';
import { Button, EmptyState, ErrorState, Loader, PageHeader, Panel, StatusBadge, Unavailable } from '../components/ui';

export function AvailabilityView() {
  const filters = useFilters('availability');
  const me = useMe();
  const v = filters.values;
  const params = { customerId: v.customerId, period: v.period || 'current_month', from: v.from, to: v.to };
  const query = useQuery({ queryKey: ['sla', params], queryFn: () => api.get(`/api/sla${qs(params)}`), enabled: filters.ready });
  const customers: any[] = query.data?.customers ?? [];

  const allObjects = useMemo(() => customers.flatMap((c) => c.services.flatMap((s: any) => s.objects.map((o: any) => ({ ...o, customer_name: c.name, service_name: s.name })))), [customers]);
  const objects = allObjects.filter((o) => (!v.serviceId || o.service_id === v.serviceId) && (!v.systemId || o.system_id === v.systemId) && (!v.objectId || o.id === v.objectId) && (!v.os || o.os === v.os) && (!v.status || o.sla_status === v.status));
  const statusFacet = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of allObjects) counts[o.sla_status] = (counts[o.sla_status] ?? 0) + 1;
    return counts;
  }, [allObjects]);
  const { sorted, sort, dir, onSort } = useLocalSort(objects, 'availability', 'asc');

  const calc = (level: string, id: string) => filters.setMany({ calc: `${level}:${id}` });
  const history = (level: string, id: string) => filters.setMany({ level, levelId: id });
  const [calcLevel, calcId] = v.calc ? v.calc.split(':') : [null, null];

  const chartLevel = v.level ?? (v.objectId ? 'object' : v.serviceId ? 'service' : 'customer');
  const chartId = v.levelId ?? v.objectId ?? v.serviceId ?? (customers.find((c) => c.value !== null) ?? customers[0])?.id;
  const chartName = useMemo(() => {
    for (const c of customers) {
      if (c.id === chartId) return c.name;
      for (const s of c.services) {
        if (s.id === chartId) return s.name;
        for (const o of s.objects) if (o.id === chartId) return o.name;
      }
    }
    return null;
  }, [customers, chartId]);

  const columns: Column<any>[] = [
    { key: 'name', label: 'Object', sortKey: 'name', render: (r) => <button type="button" className="whitespace-nowrap font-medium text-primary underline-offset-2 hover:underline" onClick={() => calc('object', r.id)}>{r.name}</button> },
    { key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r) => r.customer_name },
    { key: 'service', label: 'Service', sortKey: 'service_name', render: (r) => r.service_name },
    { key: 'current', label: 'Current', sortKey: 'current_status', render: (r) => <StatusBadge value={r.current_status} /> },
    { key: 'uptime', label: 'Uptime', sortKey: 'availability', align: 'right', render: (r) => (r.availability === null ? <Unavailable /> : fmtPct(r.availability)) },
    { key: 'target', label: 'Target', sortKey: 'sla_target', align: 'right', render: (r) => `${r.sla_target}%` },
    { key: 'status', label: 'SLA status', sortKey: 'sla_status', render: (r) => <StatusBadge value={r.sla_status} /> },
    { key: 'planned', label: 'Planned down', sortKey: 'plannedDowntimeMs', align: 'right', render: (r) => (r.monitoredMs === 0 ? <Unavailable /> : fmtDuration(r.plannedDowntimeMs)) },
    { key: 'unplanned', label: 'Unplanned down', sortKey: 'unplannedDowntimeMs', align: 'right', render: (r) => (r.monitoredMs === 0 ? <Unavailable /> : fmtDuration(r.unplannedDowntimeMs)) },
    { key: 'outages', label: 'Outages', sortKey: 'outageCount', align: 'right', render: (r) => (r.monitoredMs === 0 ? <Unavailable /> : r.outageCount) },
    { key: 'last', label: 'Last outage', sortKey: 'last_outage_at', render: (r) => (r.last_outage_at ? <span className="whitespace-nowrap">{fmtDate(r.last_outage_at)}</span> : <Unavailable>None recorded</Unavailable>) },
    { key: 'coverage', label: 'Data coverage', sortKey: 'dataCoverage', align: 'right', render: (r) => `${(r.dataCoverage * 100).toFixed(1)}%` },
    { key: 'included', label: 'In SLA', sortKey: 'sla_included', render: (r) => (r.sla_included ? `Yes (${r.sla_weight})` : 'Excluded') },
    { key: 'trend', label: 'Trend', render: (r) => <Button variant="ghost" onClick={() => history('object', r.id)} aria-label={`History for ${r.name}`}>Show</Button> },
  ];

  return (
    <>
      <PageHeader title="Availability & SLA" description={query.data ? `Period: ${query.data.period.label}, boundaries in ${query.data.period.timezone}. Results are calculated up to the current time.` : undefined} />
      <FilterBar filters={filters} viewKey="availability" fields={['service', 'system', 'object', 'os', 'status', 'period']} facets={{ status: statusFacet }} statusLabelText="SLA status" periodRequired />
      {query.isLoading && <Loader />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && customers.length === 0 && <EmptyState title="No customers in this scope" />}
      {customers.length > 0 && (
        <>
          <SlaSummary customers={customers} onCalculation={calc} onHistory={history} />
          {chartId && chartName && <div className="mb-3"><AvailabilityChart level={chartLevel} id={chartId} name={chartName} /></div>}
          <Panel title="Monitored objects">
            {sorted.length === 0 ? (
              <EmptyState title="No objects match the current filters" action={<Button onClick={filters.clear}>Clear filters</Button>} />
            ) : (
              <DataTable caption="Monitored objects" columns={columns} rows={sorted} rowKey={(r) => r.id} sort={sort} dir={dir} onSort={onSort} />
            )}
          </Panel>
        </>
      )}
      <DetailDrawer open={!!calcId} onClose={() => filters.setMany({ calc: null })} title="SLA calculation" subtitle={calcLevel ? `${calcLevel[0].toUpperCase()}${calcLevel.slice(1)} level` : undefined} wide>
        {calcId && query.data && <SlaCalculation level={calcLevel!} id={calcId} customers={customers} period={query.data.period} canEdit={me.data?.user.role === 'admin'} />}
      </DetailDrawer>
    </>
  );
}
