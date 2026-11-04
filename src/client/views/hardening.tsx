import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../lib/api';
import { fmtDate, fmtDateTime } from '../lib/format';
import { useFilters, useLocalSort, useMe } from '../lib/hooks';
import { Column, DataTable } from '../components/DataTable';
import { AuditHistory, RecordDrawer, RelatedLinks } from '../components/DetailDrawer';
import { EntityTable, RecordLink, useEntityList } from '../components/EntityTable';
import { FilterBar } from '../components/FilterBar';
import { RiskAcceptanceForm } from '../components/risk';
import { Button, EmptyState, ErrorState, FieldList, Loader, PageHeader, Panel, Section, StatusBadge, Unavailable } from '../components/ui';
import { HierarchyPath } from './operational';

const scoreText = (score: number | null) => (score === null ? <Unavailable>No evaluated controls</Unavailable> : `${score.toFixed(1)}%`);

export function HardeningSummary({ data, level, onLevel }: { data: any; level: string; onLevel: (l: string) => void }) {
  const t = data.total;
  const { sorted, sort, dir, onSort } = useLocalSort<any>(data.groups, 'score', 'asc');
  const columns: Column<any>[] = [
    { key: 'name', label: level[0].toUpperCase() + level.slice(1), sortKey: 'name', render: (r) => r.name },
    ...(level !== 'customer' ? [{ key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r: any) => r.customer_name }] : []),
    { key: 'score', label: 'Score', sortKey: 'score', align: 'right', render: (r) => scoreText(r.score) },
    { key: 'denominator', label: 'Evaluated', sortKey: 'denominator', align: 'right', render: (r) => r.denominator },
    { key: 'passed', label: 'Passed', sortKey: 'passed', align: 'right', render: (r) => r.passed },
    { key: 'failed', label: 'Failed', sortKey: 'failed', align: 'right', render: (r) => r.failed },
    { key: 'warning', label: 'Warning', sortKey: 'warning', align: 'right', render: (r) => r.warning },
    { key: 'na', label: 'N/A', sortKey: 'not_applicable', align: 'right', render: (r) => r.not_applicable },
    { key: 'nc', label: 'Not checked', sortKey: 'not_checked', align: 'right', render: (r) => r.not_checked },
    { key: 'coverage', label: 'Coverage', sortKey: 'coverage', align: 'right', render: (r) => (r.coverage === null ? <Unavailable /> : `${r.coverage.toFixed(0)}%`) },
    { key: 'accepted', label: 'Accepted exceptions', sortKey: 'accepted_exceptions', align: 'right', render: (r) => r.accepted_exceptions },
    { key: 'scan', label: 'Last scan', sortKey: 'last_scan', render: (r) => <span className="whitespace-nowrap">{r.last_scan ? fmtDate(r.last_scan) : <Unavailable>No scan</Unavailable>}</span> },
  ];
  return (
    <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
      <Panel
        title="Compliance"
        actions={
          <label className="flex items-center gap-1 text-[11px] text-muted">
            Group by
            <select value={level} onChange={(e) => onLevel(e.target.value)}>
              {['customer', 'service', 'system', 'object'].map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
            </select>
          </label>
        }
      >
        <div className="num flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-line px-3 py-2">
          <span className="text-xl font-semibold">{scoreText(t.score)}</span>
          <span>{t.passed} passed of {t.denominator} evaluated</span>
          <span><StatusBadge value="failed" /> {t.failed}</span>
          <span><StatusBadge value="warning" /> {t.warning}</span>
          <span><StatusBadge value="not_applicable" /> {t.not_applicable}</span>
          <span><StatusBadge value="not_checked" /> {t.not_checked}</span>
          <span>Scan coverage: {t.coverage === null ? 'Unknown' : `${t.coverage.toFixed(1)}%`}</span>
          <span>Accepted exceptions, reported separately: {t.accepted_exceptions}</span>
        </div>
        <p className="border-b border-line px-3 py-1 text-[11px] text-muted">Formula: {data.formula}</p>
        {data.groups.length === 0 ? <EmptyState title="No controls in this scope" /> : <DataTable caption="Hardening compliance" columns={columns} rows={sorted} rowKey={(r) => r.id} sort={sort} dir={dir} onSort={onSort} />}
      </Panel>
      <Panel title="Score trend (monthly)">
        {data.trend.length === 0 ? (
          <EmptyState title="No scan history" />
        ) : (
          <div className="h-52 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend} margin={{ left: -18, right: 6, top: 6 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--muted)', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--line)', fontSize: 11 }} formatter={(value: any) => [value === null ? 'No evaluated controls' : `${Number(value).toFixed(1)}%`, 'Score']} />
                <Line dataKey="score" stroke="var(--primary)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </div>
  );
}

function SimulateVersion({ controlId }: { controlId: string }) {
  const client = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.post(`/api/admin/controls/${controlId}/new-version`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['record'] });
      void client.invalidateQueries({ queryKey: ['records'] });
    },
  });
  return (
    <div>
      <Button disabled={run.isPending} onClick={() => run.mutate()}>Simulate control version update (demo)</Button>
      {run.isSuccess && <p role="status" className="mt-1">New version {run.data.version}. {run.data.flagged.length} accepted request(s) now need review.</p>}
      {run.isError && <ErrorState error={run.error} />}
    </div>
  );
}

export function HardeningView() {
  const filters = useFilters('hardening');
  const me = useMe();
  const navigate = useNavigate();
  const v = filters.values;
  const level = v.groupBy ?? 'customer';
  const [requesting, setRequesting] = useState(false);
  const summaryParams = { customerId: v.customerId, serviceId: v.serviceId, systemId: v.systemId, objectId: v.objectId, os: v.os, groupBy: level };
  const summary = useQuery({ queryKey: ['hardening-summary', summaryParams], queryFn: () => api.get(`/api/hardening/summary${qs(summaryParams)}`), enabled: filters.ready });
  const list = useEntityList('hardening', filters);

  const columns: Column<any>[] = [
    { key: 'id', label: 'Control', sortKey: 'control_code', render: (r) => <RecordLink id={r.id} row={r} onOpen={(id) => filters.set('record', id)} /> },
    { key: 'title', label: 'Title', sortKey: 'title', render: (r) => r.title },
    { key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r) => r.customer_name },
    { key: 'object', label: 'Object', sortKey: 'object_name', render: (r) => r.object_name },
    { key: 'result', label: 'Result', sortKey: 'result', render: (r) => <StatusBadge value={r.result} /> },
    { key: 'severity', label: 'Severity', sortKey: 'severity_rank', render: (r) => <StatusBadge value={r.severity} /> },
    { key: 'scan', label: 'Last scan', sortKey: 'scanned_at', render: (r) => <span className="whitespace-nowrap">{r.scanned_at ? fmtDate(r.scanned_at) : <Unavailable>No scan</Unavailable>}</span> },
    { key: 'acceptance', label: 'Risk acceptance', sortKey: 'acceptance_status', render: (r) => <StatusBadge value={r.acceptance_status} /> },
  ];

  return (
    <>
      <PageHeader title="Hardening" description="Technical results by customer, service, system and object." />
      <FilterBar filters={filters} viewKey="hardening" fields={['search', 'service', 'system', 'object', 'os', 'severity', 'status']} facets={list.data?.facets} statusLabelText="Result" />
      {summary.isLoading && <Loader />}
      {summary.isError && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      {summary.data && <HardeningSummary data={summary.data} level={level} onLevel={(l) => filters.set('groupBy', l)} />}
      <EntityTable query={list} filters={filters} columns={columns} caption="Control results" />
      <RecordDrawer entity="hardening" id={v.record ?? null} onClose={() => { setRequesting(false); filters.set('record', null); }} title={(r) => `${r.control_code}: ${r.title}`} wide>
        {({ record: r, related, acceptanceHistory, audit }) => (
          <>
            <FieldList
              items={[
                ['Affected object', <HierarchyPath record={r} />],
                ['Operating system', r.object_os],
                ['Baseline', `${r.baseline_name} ${r.baseline_version}`],
                ['Control version', r.control_version],
                ['Result', <StatusBadge value={r.result} />],
                ['Severity', <StatusBadge value={r.severity} />],
                ['Last scan', r.scanned_at ? fmtDateTime(r.scanned_at) : <Unavailable>No scan</Unavailable>],
                ['Actual result', r.actual_result],
                ['Evidence', r.evidence],
                ['Remediation', r.remediation],
                ['Risk acceptance', <StatusBadge value={r.acceptance_status} />],
              ]}
            />
            {r.acceptance_status === 'accepted' && <p className="rounded border border-line bg-surface-2 p-2">This result stays <strong>{r.result === 'failed' ? 'Failed' : 'Warning'}</strong> and still counts against the compliance score. The accepted exception is reported separately.</p>}
            {(r.result === 'failed' || r.result === 'warning') && !requesting && (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="primary" onClick={() => setRequesting(true)}>Request risk acceptance</Button>
                {me.data?.user.role === 'admin' && <SimulateVersion controlId={r.control_id} />}
              </div>
            )}
            {requesting && (
              <RiskAcceptanceForm
                result={r}
                onCancel={() => setRequesting(false)}
                onDone={(risk) => {
                  setRequesting(false);
                  navigate(`/risk-acceptances${qs({ record: risk.id, customerId: r.customer_id })}`);
                }}
              />
            )}
            <Section title="Acceptance history">
              {acceptanceHistory.length === 0 ? (
                <p className="text-muted">No risk acceptance has been requested for this control on this object.</p>
              ) : (
                <ul className="space-y-1">
                  {acceptanceHistory.map((a: any) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-1.5">
                      <button type="button" className="text-primary underline" onClick={() => navigate(`/risk-acceptances${qs({ record: a.id, customerId: r.customer_id })}`)}>{a.id}</button>
                      <StatusBadge value={a.status} />
                      {a.status === 'accepted' && (a.review_required || !a.approved_scope) && <StatusBadge value="review_required" />}
                      <span className="num text-muted">Version {a.control_version}. Expires {fmtDate(a.expiry_at)}{a.self_approved ? '. Self-approved' : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <RelatedLinks related={related} />
            {audit.length > 0 && <AuditHistory audit={audit} />}
          </>
        )}
      </RecordDrawer>
    </>
  );
}
