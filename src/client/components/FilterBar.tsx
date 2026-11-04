import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Search, Trash2, X } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { api } from '../lib/api';
import { useFilterOptions, type Filters } from '../lib/hooks';
import { Button, statusLabel } from './ui';

export type FilterField = 'service' | 'system' | 'object' | 'os' | 'severity' | 'status' | 'period' | 'search' | 'mine';

interface Props {
  filters: Filters;
  viewKey: string;
  fields: FilterField[];
  facets?: { status?: Record<string, number>; severity?: Record<string, number> };
  statusLabelText?: string;
  allowOpen?: boolean;
  children?: React.ReactNode;
}

const PERIODS = [
  ['current_month', 'Current month'],
  ['previous_month', 'Previous month'],
  ['quarter', 'This quarter'],
  ['year', 'This year'],
  ['custom', 'Custom range'],
];

function SelectFilter({ label, value, onChange, options, allLabel }: { label: string; value: string | undefined; onChange: (v: string | null) => void; options: { value: string; label: string }[]; allLabel: string }) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted">
      <span>{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterBar({ filters, viewKey, fields, facets, statusLabelText = 'Status', allowOpen, children }: Props) {
  const { values, set, clear, activeCount } = filters;
  const options = useFilterOptions();
  const o = options.data ?? { services: [], systems: [], objects: [], os: [] };
  const inCustomer = (r: any) => !values.customerId || r.customer_id === values.customerId;
  const services = o.services.filter(inCustomer);
  const systems = o.systems.filter((r: any) => inCustomer(r) && (!values.serviceId || r.service_id === values.serviceId));
  const objects = o.objects.filter((r: any) => inCustomer(r) && (!values.serviceId || r.service_id === values.serviceId) && (!values.systemId || r.system_id === values.systemId));
  const toOption = (r: any) => ({ value: r.id, label: r.name });
  const facetOptions = (facet?: Record<string, number>) => Object.entries(facet ?? {}).map(([k, n]) => ({ value: k, label: `${statusLabel(k)} (${n})` }));

  const statusOptions = facetOptions(facets?.status);
  if (values.status && values.status !== 'open' && !statusOptions.some((s) => s.value === values.status)) statusOptions.push({ value: values.status, label: `${statusLabel(values.status)} (0)` });
  if (allowOpen) statusOptions.unshift({ value: 'open', label: 'All open' });
  const severityOptions = facetOptions(facets?.severity);
  if (values.severity && !severityOptions.some((s) => s.value === values.severity)) severityOptions.push({ value: values.severity, label: `${statusLabel(values.severity)} (0)` });

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded border border-line bg-surface px-2.5 py-1.5" role="group" aria-label="Filters">
      {fields.includes('search') && (
        <label className="flex items-center gap-1 text-muted">
          <Search size={12} aria-hidden />
          <span className="sr-only">Search</span>
          <input type="search" placeholder="Search" value={values.q ?? ''} onChange={(e) => set('q', e.target.value || null)} className="w-36" />
        </label>
      )}
      {fields.includes('service') && <SelectFilter label="Service" value={values.serviceId} onChange={(v) => set('serviceId', v)} options={services.map(toOption)} allLabel="All" />}
      {fields.includes('system') && <SelectFilter label="System" value={values.systemId} onChange={(v) => set('systemId', v)} options={systems.map(toOption)} allLabel="All" />}
      {fields.includes('object') && <SelectFilter label="Object" value={values.objectId} onChange={(v) => set('objectId', v)} options={objects.map(toOption)} allLabel="All" />}
      {fields.includes('os') && <SelectFilter label="OS" value={values.os} onChange={(v) => set('os', v)} options={(o.os as string[]).map((x) => ({ value: x, label: x }))} allLabel="All" />}
      {fields.includes('severity') && <SelectFilter label="Severity" value={values.severity} onChange={(v) => set('severity', v)} options={severityOptions} allLabel="All" />}
      {fields.includes('status') && <SelectFilter label={statusLabelText} value={values.status} onChange={(v) => set('status', v)} options={statusOptions} allLabel="All" />}
      {fields.includes('period') && (
        <>
          <SelectFilter label="Period" value={values.period} onChange={(v) => set('period', v)} options={PERIODS.map(([value, label]) => ({ value, label }))} allLabel="All time" />
          {values.period === 'custom' && (
            <>
              <label className="flex items-center gap-1 text-[11px] text-muted">
                From <input type="date" value={values.from ?? ''} onChange={(e) => set('from', e.target.value || null)} />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-muted">
                To <input type="date" value={values.to ?? ''} onChange={(e) => set('to', e.target.value || null)} />
              </label>
            </>
          )}
          <span className="text-[11px] text-muted">Times in UTC</span>
        </>
      )}
      {fields.includes('mine') && (
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={values.mine === 'true'} onChange={(e) => set('mine', e.target.checked ? 'true' : null)} /> Assigned to me
        </label>
      )}
      {children}
      <span className="ml-auto flex items-center gap-1">
        <SavedViews viewKey={viewKey} filters={filters} />
        {activeCount > 0 && (
          <Button onClick={clear}>
            <X size={12} aria-hidden /> Clear filters ({activeCount})
          </Button>
        )}
      </span>
    </div>
  );
}

function SavedViews({ viewKey, filters }: { viewKey: string; filters: Filters }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const query = useQuery<any[]>({ queryKey: ['saved-views'], queryFn: () => api.get('/api/me/saved-views') });
  const views = (query.data ?? []).filter((v) => v.view === viewKey);
  const refresh = () => client.invalidateQueries({ queryKey: ['saved-views'] });
  const create = useMutation({
    mutationFn: () => {
      const params = { ...filters.values };
      delete params.record;
      delete params.page;
      return api.post('/api/me/saved-views', { view: viewKey, name: name.trim(), params });
    },
    onSuccess: () => {
      setName('');
      void refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/me/saved-views/${id}`), onSuccess: refresh });

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button>
          <Bookmark size={12} aria-hidden /> Saved views{views.length ? ` (${views.length})` : ''}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 w-64 rounded border border-line bg-surface-2 p-2 text-xs shadow-lg">
          {views.length === 0 && <p className="mb-2 text-muted">No saved views for this page yet.</p>}
          <ul className="mb-2 flex flex-col gap-0.5">
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-1">
                <Popover.Close asChild>
                  <button type="button" className="flex-1 truncate rounded px-1 py-0.5 text-left hover:bg-surface" onClick={() => { filters.clear(); filters.setMany(v.params); }}>
                    {v.name}
                  </button>
                </Popover.Close>
                <Button variant="ghost" aria-label={`Delete saved view ${v.name}`} onClick={() => remove.mutate(v.id)}>
                  <Trash2 size={12} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
            <label className="flex-1">
              <span className="sr-only">Saved view name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name current filters" maxLength={100} className="w-full" />
            </label>
            <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>Save</Button>
          </form>
          {create.isError && <p role="alert" className="mt-1 text-bad">{(create.error as Error).message}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
