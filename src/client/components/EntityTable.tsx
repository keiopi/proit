import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import type { Filters } from '../lib/hooks';
import { Column, DataTable, Pagination } from './DataTable';
import { Button, EmptyState, ErrorState, HoverCard, Loader, Panel } from './ui';

/** Fetches one record type with the current filters and renders it as a table. */
export function useEntityList(entity: string, filters: Filters, extra: Record<string, string> = {}) {
  const v = filters.values;
  const params = {
    customerId: v.customerId, serviceId: v.serviceId, systemId: v.systemId, objectId: v.objectId, os: v.os,
    severity: v.severity, status: v.status, q: v.q, mine: v.mine, period: v.period, from: v.from, to: v.to,
    sort: v.sort, dir: v.dir, page: v.page, kind: v.kind, source: v.source, bucket: v.bucket, renewal: v.renewal,
    ...extra,
  };
  return useQuery({
    queryKey: ['records', entity, params],
    queryFn: () => api.get(`/api/records/${entity}${qs(params)}`),
    enabled: filters.ready,
    placeholderData: (prev) => prev,
  });
}

export function RecordLink({ id, row, onOpen }: { id: string; row: any; onOpen: (id: string) => void }) {
  return (
    <HoverCard
      trigger={
        <button type="button" onClick={() => onOpen(id)} className="whitespace-nowrap font-medium text-primary underline-offset-2 hover:underline">
          {id}
        </button>
      }
    >
      <strong className="block">{row.title}</strong>
      {row.description && <p className="mt-1 text-muted">{row.description}</p>}
      <p className="mt-1 text-muted">{[row.customer_name, row.service_name, row.object_name].filter(Boolean).join(' / ')}</p>
    </HoverCard>
  );
}

export function EntityTable({ query, filters, columns, caption, title, actions }: { query: ReturnType<typeof useEntityList>; filters: Filters; columns: Column<any>[]; caption: string; title?: ReactNode; actions?: ReactNode }) {
  const v = filters.values;
  const data = query.data;
  const onSort = (key: string) => {
    const nextDir = v.sort === key && v.dir === 'asc' ? 'desc' : 'asc';
    filters.setMany({ sort: key, dir: nextDir, page: null });
  };
  return (
    <Panel title={title ?? caption} actions={actions}>
      {query.isLoading && <Loader />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {data && data.total === 0 && (
        <EmptyState
          title="No matching records"
          hint={filters.activeCount ? 'Nothing matches the current filters.' : 'There are no records of this type in your scope.'}
          action={filters.activeCount ? <Button onClick={filters.clear}>Clear filters</Button> : undefined}
        />
      )}
      {data && data.total > 0 && (
        <DataTable
          caption={caption}
          columns={columns}
          rows={data.rows}
          rowKey={(r) => r.id}
          sort={v.sort}
          dir={v.dir}
          onSort={onSort}
          selectedKey={v.record}
          footer={<Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => filters.set('page', String(p))} />}
        />
      )}
    </Panel>
  );
}
