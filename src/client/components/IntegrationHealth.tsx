import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Button, ErrorState, Loader, StatusBadge } from './ui';

export function IntegrationHealth({ ids }: { ids: string[] }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['integrations'], queryFn: () => api.get('/api/integrations') });
  const refresh = useMutation({
    mutationFn: (id: string) => api.post(`/api/integrations/${id}/refresh`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['integrations'] });
      void client.invalidateQueries({ queryKey: ['records'] });
    },
  });
  if (query.isLoading) return <Loader label="Loading integration health" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const rows = query.data.rows.filter((r: any) => ids.includes(r.id));
  return (
    <div className="mb-2 grid gap-2 md:grid-cols-2">
      {rows.map((r: any) => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-line bg-surface px-2.5 py-1.5 text-xs">
          <strong>{r.name}</strong>
          <span className="rounded bg-accent-bg px-1 text-[10px] font-semibold uppercase text-primary">Simulated</span>
          <StatusBadge value={r.status} />
          <span className="num text-muted">Last refresh: {fmtDateTime(r.last_success_at)}</span>
          <span className="num text-muted">{r.records_in_scope} records in scope</span>
          {r.status !== 'healthy' && <span className="w-full text-warn">{r.message}</span>}
          {query.data.canRefresh && (
            <Button className="ml-auto" disabled={refresh.isPending} onClick={() => refresh.mutate(r.id)}>
              <RefreshCw size={12} aria-hidden className={refresh.isPending && refresh.variables === r.id ? 'animate-spin' : ''} /> Refresh
            </Button>
          )}
        </div>
      ))}
      {refresh.isError && <ErrorState error={refresh.error} />}
    </div>
  );
}
