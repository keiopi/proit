import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { fmtDate, fmtDateTime, toDateInput } from '../lib/format';
import { useFilters, type Filters } from '../lib/hooks';
import { Column } from '../components/DataTable';
import { AuditHistory, RecordDrawer } from '../components/DetailDrawer';
import { EntityTable, RecordLink, useEntityList } from '../components/EntityTable';
import { FilterBar } from '../components/FilterBar';
import { ReminderSettings } from '../components/ReminderSettings';
import { Button, ErrorState, FieldList, FormField, Loader, PageHeader, Panel, Section, StatusBadge, Unavailable } from '../components/ui';

const missing = (value: number | null, text = 'Not measured') => (value === null ? <Unavailable>{text}</Unavailable> : value);

export function LicenseSummary({ customerId }: { customerId?: string }) {
  const query = useQuery({ queryKey: ['records', 'licenses-summary', customerId], queryFn: () => api.get(`/api/licenses/summary${qs({ customerId })}`) });
  if (query.isLoading) return <Loader />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const d = query.data;
  return (
    <Panel
      className="mb-2"
      title="Summary by unit and contractual scope"
      actions={<span className="num text-[11px] text-muted">{d.shortfalls} potential shortfalls, {d.renewals} upcoming renewals, {d.missing} missing measurements</span>}
    >
      <div className="overflow-x-auto">
        <table className="num w-full text-left text-xs">
          <thead className="text-[11px] uppercase text-muted">
            <tr>
              <th className="px-2 py-1 font-medium">Unit</th><th className="px-2 font-medium">Contractual scope</th><th className="px-2 text-right font-medium">Licenses</th><th className="px-2 text-right font-medium">Entitlement</th><th className="px-2 text-right font-medium">Measured use</th><th className="px-2 text-right font-medium">Measured against</th><th className="px-2 text-right font-medium">Potential shortfall</th><th className="px-2 text-right font-medium">Missing measurements</th>
            </tr>
          </thead>
          <tbody>
            {d.portfolio.map((g: any) => (
              <tr key={`${g.unit}-${g.contractual_scope}`} className="border-t border-line/60">
                <td className="px-2 py-1 capitalize">{g.unit}</td><td className="px-2">{g.contractual_scope}</td><td className="px-2 text-right">{g.licenses}</td><td className="px-2 text-right">{g.entitlement}</td>
                <td className="px-2 text-right">{g.measured_entitlement === 0 ? <Unavailable>Not measured</Unavailable> : g.consumption}</td>
                <td className="px-2 text-right">{g.measured_entitlement === 0 ? '-' : g.measured_entitlement}</td>
                <td className="px-2 text-right">{g.measured_entitlement === 0 ? <Unavailable /> : g.potential_shortfall}</td>
                <td className="px-2 text-right">{g.missing_measurements}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-3 py-1 text-[11px] text-muted">Quantities add up only within one unit and contractual scope, so there is no grand total. A potential shortfall means measured use exceeds entitlement. It is not a legal compliance finding.</p>
      {d.customers.length > 1 && (
        <ul className="num flex flex-wrap gap-x-4 border-t border-line px-3 py-1.5 text-xs">
          {d.customers.map((c: any) => <li key={c.customer_id}><strong>{c.customer_name}:</strong> {c.shortfalls} shortfalls, {c.renewals} renewals, {c.missing} missing</li>)}
        </ul>
      )}
    </Panel>
  );
}

export function LicenseTable({ filters, query }: { filters: Filters; query: ReturnType<typeof useEntityList> }) {
  const columns: Column<any>[] = [
    { key: 'id', label: 'ID', sortKey: 'id', render: (r) => <RecordLink id={r.id} row={r} onOpen={(id) => filters.set('record', id)} /> },
    { key: 'product', label: 'Product', sortKey: 'product', render: (r) => `${r.product} ${r.edition}` },
    { key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r) => r.customer_name },
    { key: 'model', label: 'Model', sortKey: 'model', render: (r) => r.model },
    { key: 'unit', label: 'Unit', sortKey: 'unit', render: (r) => <span className="capitalize">{r.unit}</span> },
    { key: 'scope', label: 'Scope', sortKey: 'contractual_scope', render: (r) => r.contractual_scope },
    { key: 'ent', label: 'Entitled', sortKey: 'entitlement', align: 'right', render: (r) => r.entitlement },
    { key: 'assigned', label: 'Assigned', sortKey: 'assigned', align: 'right', render: (r) => missing(r.assigned, 'Unknown') },
    { key: 'cons', label: 'Measured', sortKey: 'consumption', align: 'right', render: (r) => missing(r.consumption) },
    { key: 'bal', label: 'Balance', sortKey: 'available_balance', align: 'right', render: (r) => missing(r.available_balance, 'Unknown') },
    { key: 'state', label: 'State', sortKey: 'state', render: (r) => <StatusBadge value={r.state} /> },
    { key: 'renewal', label: 'Renewal', sortKey: 'days_to_renewal', render: (r) => <span className={`whitespace-nowrap ${r.renewal_upcoming ? 'font-semibold text-warn' : ''}`}>{fmtDate(r.renewal_at)}{r.renewal_upcoming ? ` (${r.days_to_renewal}d)` : ''}</span> },
    { key: 'owner', label: 'Owner', sortKey: 'owner', render: (r) => r.owner },
  ];
  return <EntityTable query={query} filters={filters} columns={columns} caption="License records" />;
}

function LicenseEditor({ record }: { record: any }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    owner: record.owner,
    entitlement: String(record.entitlement),
    assigned: record.assigned === null ? '' : String(record.assigned),
    consumption: record.consumption === null ? '' : String(record.consumption),
    completeness: record.completeness === null ? '' : String(record.completeness),
    renewal_at: toDateInput(record.renewal_at),
    contract_ref: record.contract_ref,
  });
  const change = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const num = (text: string) => (text.trim() === '' ? null : Number(text));
  const save = useMutation({
    mutationFn: () => api.patch(`/api/licenses/${record.id}`, {
      owner: form.owner,
      entitlement: Number(form.entitlement),
      assigned: num(form.assigned),
      consumption: num(form.consumption),
      completeness: num(form.completeness),
      renewal_at: `${form.renewal_at}T00:00:00.000Z`,
      contract_ref: form.contract_ref,
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['record', 'licenses', record.id] });
      void client.invalidateQueries({ queryKey: ['records'] });
      void client.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  return (
    <Section title="Edit record">
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <FormField label="Responsible owner"><input required value={form.owner} onChange={change('owner')} /></FormField>
        <FormField label="Contract reference"><input required value={form.contract_ref} onChange={change('contract_ref')} /></FormField>
        <FormField label={`Entitlement (${record.unit}s)`}><input required type="number" min="0" step="1" value={form.entitlement} onChange={change('entitlement')} /></FormField>
        <FormField label={`Assigned (${record.unit}s)`} hint="Leave empty if unknown"><input type="number" min="0" step="1" value={form.assigned} onChange={change('assigned')} /></FormField>
        <FormField label={`Measured consumption (${record.unit}s)`} hint="Leave empty if not measured. Empty is never treated as zero."><input type="number" min="0" step="1" value={form.consumption} onChange={change('consumption')} /></FormField>
        <FormField label="Measurement completeness (%)"><input type="number" min="0" max="100" step="1" value={form.completeness} onChange={change('completeness')} /></FormField>
        <FormField label="Renewal date (UTC)"><input required type="date" value={form.renewal_at} onChange={change('renewal_at')} /></FormField>
        <div className="sm:col-span-2">
          {save.isError && <ErrorState error={save.error} />}
          {save.isSuccess && <p role="status" className="mb-1 text-ok">Saved.</p>}
          <Button type="submit" variant="primary" disabled={save.isPending}>Save changes</Button>
        </div>
      </form>
    </Section>
  );
}

export function LicensesView() {
  const filters = useFilters('licenses');
  const query = useEntityList('licenses', filters);
  const v = filters.values;
  return (
    <>
      <PageHeader title="Licenses" description="Entitlement, assignment and measured use. These are operational figures, not a verified compliance position." actions={<ReminderSettings customerId={v.customerId} field="license_days" label="License renewal reminder days" />} />
      <LicenseSummary customerId={v.customerId} />
      <FilterBar filters={filters} viewKey="licenses" fields={['search', 'status']} facets={{ status: query.data?.facets.status }} statusLabelText="State">
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={v.renewal === 'upcoming'} onChange={(e) => filters.set('renewal', e.target.checked ? 'upcoming' : null)} /> Upcoming renewal
        </label>
      </FilterBar>
      <LicenseTable filters={filters} query={query} />
      <RecordDrawer entity="licenses" id={v.record ?? null} onClose={() => filters.set('record', null)} title={(r) => `${r.product} ${r.edition}`} wide>
        {({ record: r, audit }) => (
          <>
            <FieldList
              items={[
                ['State', <StatusBadge value={r.state} />],
                ['Model', r.model],
                ['Unit', r.unit],
                ['Contractual scope', r.contractual_scope],
                ['Entitlement', r.entitlement],
                ['Assigned', missing(r.assigned, 'Unknown')],
                ['Measured consumption', missing(r.consumption)],
                ['Available balance', missing(r.available_balance, 'Unknown')],
                ['Potential shortfall', missing(r.potential_shortfall, 'Unknown')],
                ['Assigned balance', missing(r.assigned_balance, 'Unknown')],
                ['Basis', r.calculation_basis],
                ['Measured at', r.measured_at ? fmtDateTime(r.measured_at) : <Unavailable>No measurement</Unavailable>],
                ['Completeness', r.completeness === null ? <Unavailable /> : `${r.completeness}%`],
                ['Valid from', fmtDate(r.valid_from)],
                ['Renewal', `${fmtDate(r.renewal_at)} (${r.days_to_renewal} days)`],
                ['Contract', `${r.contract_ref} (simulated record, demo data)`],
              ]}
            />
            <p className="text-muted">A potential shortfall is not a legal compliance finding. Assigned quantities, measured use and verified compliance are separate things.</p>
            <LicenseEditor key={`${r.id}-${r.updated_at}`} record={r} />
            <AuditHistory audit={audit} title="Change history" />
          </>
        )}
      </RecordDrawer>
    </>
  );
}
