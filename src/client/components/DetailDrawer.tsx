import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDateTime, humanize } from '../lib/format';
import { useCarry } from '../lib/hooks';
import { Button, ErrorState, Loader, Section, StatusBadge } from './ui';

export function DetailDrawer({ open, title, subtitle, onClose, children, wide }: { open: boolean; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className={`drawer-panel fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
          <header className="flex items-start justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-sm font-semibold">{title}</Dialog.Title>
              {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Close details">
                <X size={14} aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ENTITY_PATH: Record<string, (id: string) => [string, Record<string, string>]> = {
  requests: (id) => ['/requests', { record: id }],
  projects: (id) => ['/projects', { tab: 'projects', record: id }],
  tasks: (id) => ['/projects', { tab: 'tasks', record: id }],
  activities: (id) => ['/projects', { tab: 'activities', record: id }],
  alarms: (id) => ['/alarms', { record: id }],
  vulnerabilities: (id) => ['/vulnerabilities', { record: id }],
  hardening: (id) => ['/hardening', { record: id }],
  lifecycle: (id) => ['/lifecycle', { record: id }],
  licenses: (id) => ['/licenses', { record: id }],
  risk: (id) => ['/risk-acceptances', { record: id }],
};

const RELATED_LABEL: Record<string, string> = { requests: 'Requests and incidents', alarms: 'Alarms', vulnerabilities: 'Vulnerabilities', tasks: 'Tasks', hardening: 'Failed or warning controls', lifecycle: 'Lifecycle records' };

export function RelatedLinks({ related }: { related: Record<string, any[]> }) {
  const carry = useCarry();
  const entries = Object.entries(related ?? {});
  if (entries.length === 0) return null;
  return (
    <Section title="Related records">
      <div className="space-y-2">
        {entries.map(([entity, rows]) => (
          <div key={entity}>
            <div className="mb-0.5 text-muted">{RELATED_LABEL[entity] ?? humanize(entity)}</div>
            <ul className="space-y-0.5">
              {rows.map((r) => {
                const [path, params] = ENTITY_PATH[entity](r.id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-1.5">
                    <Link className="text-primary underline" to={carry(path, params)}>{r.id}</Link>
                    <span className="min-w-0 flex-1 truncate">{r.title}</span>
                    <StatusBadge value={r.status} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function AuditHistory({ audit, title = 'Audit history' }: { audit: any[]; title?: string }) {
  return (
    <Section title={title}>
      {audit.length === 0 ? (
        <p className="text-muted">No changes recorded.</p>
      ) : (
        <ol className="space-y-1.5">
          {audit.map((a) => (
            <li key={a.id} className="rounded border border-line p-1.5">
              <div className="flex flex-wrap justify-between gap-1">
                <strong>{humanize(a.action)}</strong>
                <span className="num text-muted">{fmtDateTime(a.at)}</span>
              </div>
              <div className="text-muted">
                {a.actor_name} ({a.actor_role === 'admin' ? 'System Administrator' : a.actor_role === 'manager' ? 'Customer Manager' : 'Customer'})
              </div>
              <AuditDetail detail={a.detail} />
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function AuditDetail({ detail }: { detail: Record<string, any> }) {
  if (!detail) return null;
  const notes: string[] = [];
  if (detail.from && detail.to) notes.push(`${humanize(detail.from)} to ${humanize(detail.to)}`);
  if (detail.reason) notes.push(`Reason: ${detail.reason}`);
  if (detail.self_approved) notes.push('Self-approval: the approver also submitted this request');
  if (detail.authority) notes.push(`Authority: ${detail.authority}`);
  if (detail.before && detail.after) {
    for (const key of Object.keys(detail.after)) {
      const before = detail.before[key];
      const after = detail.after[key];
      if (key in detail.before && JSON.stringify(before) !== JSON.stringify(after)) notes.push(`${humanize(key)}: "${before ?? 'empty'}" to "${after ?? 'empty'}"`);
    }
  }
  if (detail.renewed_from) notes.push(`Renewal of ${detail.renewed_from}`);
  if (detail.renewal) notes.push(`Renewed by ${detail.renewal}`);
  if (detail.changed) notes.push(`Changed: ${detail.changed.map(humanize).join(', ')}`);
  if (notes.length === 0) return null;
  return <ul className="mt-0.5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>;
}

export function SourceLink({ source, id }: { source: string | null | undefined; id: string }) {
  if (!source) return null;
  return (
    <Link to={`/source/${source}/${encodeURIComponent(id)}`} className="inline-flex items-center gap-1 text-primary underline">
      <ExternalLink size={12} aria-hidden /> Open simulated source record (demo data)
    </Link>
  );
}

/** Loads one record and hands it to the view's detail renderer. */
export function RecordDrawer({ entity, id, onClose, title, children, wide }: { entity: string; id: string | null; onClose: () => void; title: (record: any) => ReactNode; children: (data: any) => ReactNode; wide?: boolean }) {
  const query = useQuery({ queryKey: ['record', entity, id], queryFn: () => api.get(`/api/records/${entity}/${encodeURIComponent(id!)}`), enabled: !!id });
  const record = query.data?.record;
  return (
    <DetailDrawer open={!!id} onClose={onClose} title={record ? title(record) : id ?? ''} subtitle={record ? `${record.customer_name} · ${id}` : undefined} wide={wide}>
      {query.isLoading && <Loader />}
      {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
      {query.data && children(query.data)}
    </DetailDrawer>
  );
}
