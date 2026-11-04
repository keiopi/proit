import { Link } from 'react-router-dom';
import { Column } from '../components/DataTable';
import { AuditHistory, RecordDrawer, RelatedLinks, SourceLink } from '../components/DetailDrawer';
import { EntityTable, RecordLink, useEntityList } from '../components/EntityTable';
import { FilterBar, type FilterField } from '../components/FilterBar';
import { IntegrationHealth } from '../components/IntegrationHealth';
import { FieldList, PageHeader, StatusBadge, Unavailable } from '../components/ui';
import { fmtDateTime, humanize } from '../lib/format';
import { useCarry, useFilters, type Filters } from '../lib/hooks';
import { qs } from '../lib/api';

export function hierarchyColumns(): Column<any>[] {
  return [
    { key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r) => r.customer_name },
    { key: 'service', label: 'Service', sortKey: 'service_name', render: (r) => r.service_name ?? '-' },
    { key: 'object', label: 'Object', sortKey: 'object_name', render: (r) => r.object_name ?? '-' },
  ];
}

const assignee: Column<any> = { key: 'assignee', label: 'Assignee', sortKey: 'assignee_name', render: (r) => r.assignee_name ?? <Unavailable>Unassigned</Unavailable> };
const status: Column<any> = { key: 'status', label: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} /> };
const priority: Column<any> = { key: 'priority', label: 'Priority', sortKey: 'priority', render: (r) => <StatusBadge value={r.priority} /> };
const severity: Column<any> = { key: 'severity', label: 'Severity', sortKey: 'severity', render: (r) => <StatusBadge value={r.severity} /> };
const opened: Column<any> = { key: 'opened', label: 'Opened', sortKey: 'opened_at', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.opened_at)}</span> };
const updated: Column<any> = { key: 'updated', label: 'Updated', sortKey: 'updated_at', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.updated_at)}</span> };
const titleColumn: Column<any> = { key: 'title', label: 'Title', sortKey: 'title', render: (r) => r.title };

const integrationFor = (record: any) => record.source ?? null;

export function HierarchyPath({ record }: { record: any }) {
  const parts: [string, string][] = [];
  const base = { customerId: record.customer_id, serviceId: record.service_id, systemId: record.system_id };
  if (record.customer_name) parts.push([record.customer_name, `/portfolio${qs({ customerId: base.customerId })}`]);
  if (record.service_name) parts.push([record.service_name, `/portfolio${qs({ customerId: base.customerId, serviceId: base.serviceId })}`]);
  if (record.system_name) parts.push([record.system_name, `/portfolio${qs(base)}`]);
  if (record.object_name) parts.push([record.object_name, `/availability${qs({ customerId: base.customerId, objectId: record.object_id })}`]);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {parts.map(([label, to], i) => (
        <span key={to} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted">/</span>}
          <Link className="text-primary underline" to={to}>{label}</Link>
        </span>
      ))}
    </span>
  );
}

function OperationalDetail({ entity, filters }: { entity: string; filters: Filters }) {
  const v = filters.values;
  return (
    <RecordDrawer entity={entity} id={v.record ?? null} onClose={() => filters.set('record', null)} title={(r) => r.title}>
      {({ record: r, related, audit }) => (
        <>
          {r.description && <p>{r.description}</p>}
          <FieldList
            items={[
              ['Location', <HierarchyPath record={r} />],
              ...(r.object_os ? ([['Operating system', r.object_os]] as [string, string][]) : []),
              ...(r.kind ? ([['Type', humanize(r.kind)]] as [string, string][]) : []),
              ...(r.cve ? ([['Identifier', `${r.cve} (fictional demo identifier)`], ['CVSS', r.cvss]] as [string, any][]) : []),
              ...(r.activity_type ? ([['Activity', humanize(r.activity_type)]] as [string, string][]) : []),
              ...(r.project_title ? ([['Project', r.project_title]] as [string, string][]) : []),
              ...(r.progress !== undefined ? ([['Progress', `${r.progress}%`]] as [string, string][]) : []),
              ['Status', <StatusBadge value={r.status} />],
              ...(r.severity ? ([['Severity', <StatusBadge value={r.severity} />]] as [string, any][]) : []),
              ...(r.priority ? ([['Priority', <StatusBadge value={r.priority} />]] as [string, any][]) : []),
              ['Assignee', r.assignee_name ?? <Unavailable>Unassigned</Unavailable>],
              ['Opened', fmtDateTime(r.opened_at)],
              ['Updated', fmtDateTime(r.updated_at)],
              ...(r.resolved_at ? ([['Resolved', fmtDateTime(r.resolved_at)]] as [string, string][]) : []),
              ...(r.due_at ? ([['Due', fmtDateTime(r.due_at)]] as [string, string][]) : []),
              ['Last synchronized', fmtDateTime(r.synced_at)],
            ]}
          />
          <p className="text-muted">This record is managed in its source system and is read-only here.</p>
          <SourceLink source={integrationFor(r)} id={r.id} />
          <RelatedLinks related={related} />
          {audit.length > 0 && <AuditHistory audit={audit} />}
        </>
      )}
    </RecordDrawer>
  );
}

function useLink(filters: Filters) {
  return (r: any) => <RecordLink id={r.id} row={r} onOpen={(id) => filters.set('record', id)} />;
}

export function RequestsView() {
  const filters = useFilters('requests');
  const query = useEntityList('requests', filters);
  const link = useLink(filters);
  const v = filters.values;
  const fields: FilterField[] = ['search', 'service', 'system', 'object', 'os', 'severity', 'status', 'period', 'mine'];
  const columns: Column<any>[] = [
    { key: 'id', label: 'ID', sortKey: 'id', render: link },
    { key: 'kind', label: 'Type', sortKey: 'kind', render: (r) => humanize(r.kind) },
    titleColumn, ...hierarchyColumns(), assignee, status, priority, opened, updated,
  ];
  return (
    <>
      <PageHeader title="Requests & Incidents" description="From OpenText ServiceManager (simulated). Records are read-only." />
      <IntegrationHealth ids={['servicemanager']} />
      <FilterBar filters={filters} viewKey="requests" fields={fields} facets={query.data?.facets} allowOpen>
        <label className="flex items-center gap-1 text-[11px] text-muted">
          Type
          <select value={v.kind ?? ''} onChange={(e) => filters.set('kind', e.target.value || null)}>
            <option value="">All</option>
            <option value="request">Requests</option>
            <option value="incident">Incidents</option>
          </select>
        </label>
      </FilterBar>
      <EntityTable query={query} filters={filters} columns={columns} caption="Requests and incidents" />
      <OperationalDetail entity="requests" filters={filters} />
    </>
  );
}

const TABS = [['projects', 'Jira projects'], ['tasks', 'Tasks'], ['activities', 'GitLab activity']];

export function ProjectsView() {
  const filters = useFilters('projects');
  const carry = useCarry();
  const v = filters.values;
  const tab = TABS.some(([t]) => t === v.tab) ? v.tab : 'projects';
  const query = useEntityList(tab, filters);
  const link = useLink(filters);
  const columns: Record<string, Column<any>[]> = {
    projects: [
      { key: 'id', label: 'Key', sortKey: 'id', render: link }, titleColumn,
      { key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r) => r.customer_name },
      { key: 'service', label: 'Service', sortKey: 'service_name', render: (r) => r.service_name ?? '-' },
      assignee, status, priority,
      { key: 'progress', label: 'Progress', sortKey: 'progress', align: 'right', render: (r) => `${r.progress}%` },
      { key: 'due', label: 'Due', sortKey: 'due_at', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.due_at)}</span> },
    ],
    tasks: [
      { key: 'id', label: 'ID', sortKey: 'id', render: link },
      { key: 'source', label: 'Source', sortKey: 'source', render: (r) => (r.source === 'jira' ? 'Jira' : 'GitLab') },
      titleColumn, ...hierarchyColumns(), assignee, status, priority, opened,
    ],
    activities: [
      { key: 'id', label: 'ID', sortKey: 'id', render: link },
      { key: 'type', label: 'Type', sortKey: 'activity_type', render: (r) => humanize(r.activity_type) },
      titleColumn, ...hierarchyColumns(), { ...assignee, label: 'Actor' }, status, opened,
    ],
  };
  return (
    <>
      <PageHeader title="Projects & Tasks" description="From Atlassian Jira and GitLab (simulated). Records are read-only." />
      <IntegrationHealth ids={['jira', 'gitlab']} />
      <div role="tablist" aria-label="Record type" className="mb-2 flex gap-1">
        {TABS.map(([t, label]) => (
          <Link key={t} role="tab" aria-selected={tab === t} to={carry('/projects', { tab: t })} className={`rounded border px-2 py-1 text-xs ${tab === t ? 'border-primary bg-accent-bg font-semibold text-primary' : 'border-line bg-surface hover:border-primary'}`}>
            {label}
          </Link>
        ))}
      </div>
      <FilterBar filters={filters} viewKey="projects" fields={tab === 'projects' ? ['search', 'service', 'status', 'period', 'mine'] : ['search', 'service', 'system', 'object', 'os', 'status', 'period', 'mine']} facets={query.data?.facets} allowOpen={tab !== 'activities'}>
        {tab === 'tasks' && (
          <label className="flex items-center gap-1 text-[11px] text-muted">
            Source
            <select value={v.source ?? ''} onChange={(e) => filters.set('source', e.target.value || null)}>
              <option value="">All</option>
              <option value="jira">Jira</option>
              <option value="gitlab">GitLab</option>
            </select>
          </label>
        )}
      </FilterBar>
      <EntityTable query={query} filters={filters} columns={columns[tab]} caption={TABS.find(([t]) => t === tab)![1]} />
      <OperationalDetail entity={tab} filters={filters} />
    </>
  );
}

export function AlarmsView() {
  const filters = useFilters('alarms');
  const query = useEntityList('alarms', filters);
  const link = useLink(filters);
  const columns: Column<any>[] = [
    { key: 'id', label: 'Event', sortKey: 'id', render: link }, severity, titleColumn, ...hierarchyColumns(), assignee, status, opened,
  ];
  return (
    <>
      <PageHeader title="Alarms" description="Critical and warning alarms from Zabbix (simulated). Records are read-only." />
      <IntegrationHealth ids={['zabbix']} />
      <FilterBar filters={filters} viewKey="alarms" fields={['search', 'service', 'system', 'object', 'os', 'severity', 'status', 'period', 'mine']} facets={query.data?.facets} allowOpen />
      <EntityTable query={query} filters={filters} columns={columns} caption="Alarms" />
      <OperationalDetail entity="alarms" filters={filters} />
    </>
  );
}

export function VulnerabilitiesView() {
  const filters = useFilters('vulnerabilities');
  const query = useEntityList('vulnerabilities', filters);
  const link = useLink(filters);
  const columns: Column<any>[] = [
    { key: 'id', label: 'ID', sortKey: 'id', render: link },
    { key: 'cve', label: 'Identifier', sortKey: 'cve', render: (r) => r.cve }, severity,
    { key: 'cvss', label: 'CVSS', sortKey: 'cvss', align: 'right', render: (r) => r.cvss.toFixed(1) },
    titleColumn, ...hierarchyColumns(), assignee, status, { ...opened, label: 'Detected' },
  ];
  return (
    <>
      <PageHeader title="Vulnerabilities" description="Findings from GitLab dependency scanning (simulated). Identifiers are fictional demo values." />
      <FilterBar filters={filters} viewKey="vulnerabilities" fields={['search', 'service', 'system', 'object', 'os', 'severity', 'status', 'period', 'mine']} facets={query.data?.facets} allowOpen />
      <EntityTable query={query} filters={filters} columns={columns} caption="Vulnerabilities" />
      <OperationalDetail entity="vulnerabilities" filters={filters} />
    </>
  );
}
