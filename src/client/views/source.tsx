import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime, humanize } from '../lib/format';
import { Button, ErrorState, Loader, PageHeader, Panel } from '../components/ui';

const HIDDEN = new Set(['customer_id', 'service_id', 'system_id', 'object_id', 'assignee_id', 'project_id']);

function display(key: string, value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (key.endsWith('_at')) return fmtDateTime(value);
  return String(value);
}

export function SourceView() {
  const { integration, id } = useParams();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['source', integration, id], queryFn: () => api.get(`/api/source/${integration}/${encodeURIComponent(id!)}`) });
  return (
    <>
      <PageHeader title={query.data ? `${query.data.integration}: ${id}` : `Source record ${id}`} description="Simulated source system view. This is demo data, not a real external system." actions={<Button onClick={() => navigate(-1)}><ArrowLeft size={12} aria-hidden /> Back</Button>} />
      {query.isLoading && <Loader />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && (
        <Panel title={`${query.data.source_type} (simulated, demo data)`}>
          <dl className="num grid max-w-3xl grid-cols-[minmax(130px,auto)_1fr] gap-x-3 gap-y-1 p-3 text-xs">
            {Object.entries(query.data.fields).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{humanize(k)}</dt>
                <dd className="break-words">{display(k, v)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
    </>
  );
}
