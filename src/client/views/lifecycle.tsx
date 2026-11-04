import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useFilters, type Filters } from '../lib/hooks';
import { Column } from '../components/DataTable';
import { AuditHistory, RecordDrawer, RelatedLinks } from '../components/DetailDrawer';
import { EntityTable, RecordLink, useEntityList } from '../components/EntityTable';
import { FilterBar } from '../components/FilterBar';
import { ReminderSettings } from '../components/ReminderSettings';
import { Button, ErrorState, FieldList, FormField, PageHeader, Section, StatusBadge, Unavailable } from '../components/ui';
import { HierarchyPath } from './operational';

const dateOr = (value: unknown, missing = 'Not on record') => (value ? fmtDate(value) : <Unavailable>{missing}</Unavailable>);

export function LifecycleSummary({ facets }: { facets?: Record<string, number> }) {
  const f = facets ?? {};
  return (
    <div className="num mb-2 flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-3 py-2 text-xs">
      {['unsupported', 'approaching', 'supported', 'unknown'].map((s) => (
        <span key={s} className="flex items-center gap-1"><StatusBadge value={s} /> <strong>{f[s] ?? 0}</strong></span>
      ))}
      <span className="text-muted">Status follows the verified end-of-support date. Dates are never inferred.</span>
    </div>
  );
}

export function EolTable({ filters, query }: { filters: Filters; query: ReturnType<typeof useEntityList> }) {
  const columns: Column<any>[] = [
    { key: 'id', label: 'Product', sortKey: 'product', render: (r) => <RecordLink id={`${r.product} ${r.version}`} row={r} onOpen={() => filters.set('record', r.id)} /> },
    { key: 'kind', label: 'Type', sortKey: 'kind', render: (r) => (r.kind === 'os' ? 'OS' : 'Component') },
    { key: 'vendor', label: 'Vendor', sortKey: 'vendor', render: (r) => r.vendor },
    { key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r) => r.customer_name },
    { key: 'object', label: 'Object', sortKey: 'object_name', render: (r) => r.object_name },
    { key: 'status', label: 'Status', sortKey: 'status', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'days', label: 'Days left', sortKey: 'days_remaining', align: 'right', render: (r) => (r.days_remaining === null ? <Unavailable /> : r.days_remaining) },
    { key: 'eos', label: 'End of support', sortKey: 'eos_at', render: (r) => <span className="whitespace-nowrap">{dateOr(r.eos_at)}{r.eos_at && !r.date_verified ? ' (unverified)' : ''}</span> },
    { key: 'owner', label: 'Owner', sortKey: 'owner', render: (r) => r.owner },
    { key: 'plan', label: 'Plan', sortKey: 'plan', render: (r) => (r.plan ? <span className="line-clamp-1 max-w-52">{r.plan}</span> : <span className="text-muted">None</span>) },
  ];
  return <EntityTable query={query} filters={filters} columns={columns} caption="Lifecycle records" />;
}

function PlanEditor({ record }: { record: any }) {
  const client = useQueryClient();
  const [owner, setOwner] = useState(record.owner);
  const [plan, setPlan] = useState(record.plan);
  const save = useMutation({
    mutationFn: () => api.patch(`/api/lifecycle/${record.id}`, { owner, plan }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['record', 'lifecycle', record.id] });
      void client.invalidateQueries({ queryKey: ['records', 'lifecycle'] });
    },
  });
  const dirty = owner !== record.owner || plan !== record.plan;
  return (
    <Section title="Owner and plan">
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <FormField label="Responsible owner">
          <input required maxLength={200} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </FormField>
        <FormField label="Upgrade or replacement plan">
          <textarea rows={3} maxLength={4000} value={plan} onChange={(e) => setPlan(e.target.value)} />
        </FormField>
        {save.isError && <ErrorState error={save.error} />}
        {save.isSuccess && !dirty && <p role="status" className="text-ok">Saved.</p>}
        <Button type="submit" variant="primary" disabled={!dirty || !owner.trim() || save.isPending}>Save changes</Button>
      </form>
    </Section>
  );
}

export function LifecycleView() {
  const filters = useFilters('lifecycle');
  const query = useEntityList('lifecycle', filters);
  const v = filters.values;
  return (
    <>
      <PageHeader title="Lifecycle" description="Operating systems and installed components by customer, service, system and object." actions={<ReminderSettings customerId={v.customerId} field="lifecycle_days" label="Lifecycle reminder days" />} />
      <LifecycleSummary facets={query.data?.facets.status} />
      <FilterBar filters={filters} viewKey="lifecycle" fields={['search', 'service', 'system', 'object', 'os', 'status']} facets={{ status: query.data?.facets.status }} />
      <EolTable filters={filters} query={query} />
      <RecordDrawer entity="lifecycle" id={v.record ?? null} onClose={() => filters.set('record', null)} title={(r) => `${r.product} ${r.version}`}>
        {({ record: r, related, audit }) => (
          <>
            <FieldList
              items={[
                ['Location', <HierarchyPath record={r} />],
                ['Vendor', r.vendor],
                ['Type', r.kind === 'os' ? 'Operating system' : 'Installed component'],
                ['Status', <StatusBadge value={r.status} />],
                ['Why', r.status_reason],
                ['Deciding deadline', r.deciding_deadline ? `End of support, ${fmtDate(r.deciding_deadline)}` : <Unavailable>No verified deadline</Unavailable>],
                ['Days remaining', r.days_remaining === null ? <Unavailable /> : r.days_remaining],
              ]}
            />
            <Section title="Deadlines">
              <FieldList
                items={[
                  ['End of support', <>{dateOr(r.eos_at)}{r.eos_at && !r.date_verified ? ' (unverified, not used)' : ''}<span className="block text-[11px] text-muted">Standard vendor support ends. This decides the status.</span></>],
                  ['Extended support', <>{dateOr(r.extended_at, 'Not applicable or not on record')}<span className="block text-[11px] text-muted">Paid or extended support may run to this date.</span></>],
                  ['End of life', <>{dateOr(r.eol_at)}<span className="block text-[11px] text-muted">The product is fully retired by the vendor.</span></>],
                ]}
              />
            </Section>
            <Section title="Source of this information">
              <FieldList items={[['Source', r.info_source ?? <Unavailable>No source on record</Unavailable>], ['Last verified', r.verified_at ? fmtDate(r.verified_at) : <Unavailable>Never verified</Unavailable>]]} />
            </Section>
            <Section title={`Affected objects (${r.affected_count})`}>
              <p>{r.affected_objects.map((o: any) => o.name).join(', ')}</p>
            </Section>
            <PlanEditor key={`${r.id}-${r.updated_at}`} record={r} />
            <RelatedLinks related={related} />
            <AuditHistory audit={audit} title="Change history" />
          </>
        )}
      </RecordDrawer>
    </>
  );
}
