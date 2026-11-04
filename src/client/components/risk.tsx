import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { fmtDate, fmtDateTime, toDateInput } from '../lib/format';
import { useMe } from '../lib/hooks';
import { Column } from './DataTable';
import { RecordLink } from './EntityTable';
import { Button, ErrorState, FieldList, FormField, Loader, Section, StatusBadge } from './ui';

export function useInvalidateRisk() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: ['records'] }),
    client.invalidateQueries({ queryKey: ['record'] }),
    client.invalidateQueries({ queryKey: ['overview'] }),
    client.invalidateQueries({ queryKey: ['hardening-summary'] }),
    client.invalidateQueries({ queryKey: ['notifications'] }),
  ]);
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const endOfDay = (date: string) => `${date}T23:59:59.000Z`;

/**
 * Creates a draft from a control result, or edits an existing draft.
 * Customer, baseline, control version and evidence come from the record on the server.
 */
export function RiskAcceptanceForm({ result, draft, onDone, onCancel }: { result?: any; draft?: any; onDone: (risk: any) => void; onCancel: () => void }) {
  const customerId = result?.customer_id ?? draft.customer_id;
  const controlId = result?.control_id ?? draft.control_id;
  const approvers = useQuery<any[]>({ queryKey: ['approvers', customerId], queryFn: () => api.get(`/api/risk/approvers${qs({ customerId })}`) });
  const peers = useQuery({ queryKey: ['control-peers', customerId, controlId], queryFn: () => api.get(`/api/records/hardening${qs({ customerId, pageSize: 500 })}`) });
  const invalidate = useInvalidateRisk();

  const anchorObject = result?.object_id;
  const [objectIds, setObjectIds] = useState<string[]>(draft ? draft.object_ids : [anchorObject]);
  const [justification, setJustification] = useState(draft?.justification ?? '');
  const [residualRisk, setResidualRisk] = useState(draft?.residual_risk ?? 'medium');
  const [compensating, setCompensating] = useState(draft?.compensating_controls ?? '');
  const [ownerId, setOwnerId] = useState(draft?.risk_owner_id ?? '');
  const [approverId, setApproverId] = useState(draft?.approver_id ?? '');
  const [expiry, setExpiry] = useState(draft ? toDateInput(draft.expiry_at) : inDays(180));
  const [review, setReview] = useState(draft ? toDateInput(draft.review_at) : inDays(90));

  const owners = approvers.data ?? [];
  const defaultOwner = owners.find((a) => a.kind === 'owner')?.id ?? '';
  const effectiveOwner = ownerId || defaultOwner;
  const effectiveApprover = approverId || defaultOwner;
  const eligible = (peers.data?.rows ?? []).filter((r: any) => r.control_id === controlId && (r.result === 'failed' || r.result === 'warning' || objectIds.includes(r.object_id)));

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const unchanged = (date: string, current: unknown) => !!draft && date === toDateInput(current);
      const common = {
        justification, residualRisk, compensatingControls: compensating, riskOwnerId: effectiveOwner, approverId: effectiveApprover,
        // An untouched date keeps its exact stored time rather than moving to the end of the day.
        ...(unchanged(expiry, draft?.expiry_at) ? {} : { expiryAt: endOfDay(expiry) }),
        ...(unchanged(review, draft?.review_at) ? {} : { reviewAt: endOfDay(review) }),
      };
      let risk = draft
        ? await api.patch(`/api/risk/${draft.id}`, common)
        : await api.post('/api/risk', { ...common, controlResultId: result.id, objectIds });
      if (draft) risk = await api.post(`/api/risk/${draft.id}/scope`, { objectIds });
      if (submit) risk = await api.post(`/api/risk/${risk.id}/submit`);
      return risk;
    },
    onSuccess: async (risk) => {
      await invalidate();
      onDone(risk);
    },
  });

  const toggleObject = (id: string, on: boolean) => setObjectIds((list) => (on ? [...list, id] : list.filter((x) => x !== id)));
  const onSubmit = (e: FormEvent) => e.preventDefault();

  const source = result ?? draft;
  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded border border-primary p-2.5" aria-label="Risk acceptance request">
      <h3 className="font-semibold">{draft ? `Edit draft ${draft.id}` : 'New risk acceptance request'}</h3>
      <FieldList
        items={[
          ['Customer', source.customer_name],
          ['Control', result ? `${result.control_code}: ${result.title}` : draft.title],
          ['Baseline', source.baseline_name],
          ['Control version', source.control_version],
          ['Risk severity', <StatusBadge value={source.severity} />],
          ['Evidence', source.evidence],
        ]}
      />
      <fieldset className="rounded border border-line p-2">
        <legend className="px-1 text-xs font-medium text-muted">Affected objects</legend>
        {peers.isLoading && <Loader />}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {eligible.map((r: any) => (
            <label key={r.object_id} className="flex items-center gap-1">
              <input type="checkbox" checked={objectIds.includes(r.object_id)} disabled={r.object_id === anchorObject} onChange={(e) => toggleObject(r.object_id, e.target.checked)} />
              {r.object_name} <StatusBadge value={r.result} />
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="Business justification">
        <textarea required rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
      </FormField>
      <FormField label="Compensating controls">
        <textarea required rows={2} value={compensating} onChange={(e) => setCompensating(e.target.value)} />
      </FormField>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Residual risk">
          <select value={residualRisk} onChange={(e) => setResidualRisk(e.target.value)}>
            {['low', 'medium', 'high', 'critical'].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
          </select>
        </FormField>
        <FormField label="Risk owner">
          <select value={effectiveOwner} onChange={(e) => setOwnerId(e.target.value)}>
            {owners.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
          </select>
        </FormField>
        <FormField label="Designated approver">
          <select value={effectiveApprover} onChange={(e) => setApproverId(e.target.value)}>
            {owners.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
          </select>
        </FormField>
        <FormField label="Review date (UTC)">
          <input type="date" required value={review} onChange={(e) => setReview(e.target.value)} />
        </FormField>
        <FormField label="Expiry date (UTC)">
          <input type="date" required value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </FormField>
      </div>
      {save.isError && <ErrorState error={save.error} />}
      <div className="flex flex-wrap gap-1.5">
        <Button disabled={save.isPending || !justification.trim() || objectIds.length === 0} onClick={() => save.mutate(false)}>Save draft</Button>
        <Button variant="primary" disabled={save.isPending || !justification.trim() || !compensating.trim() || objectIds.length === 0} onClick={() => save.mutate(true)}>Save and submit for approval</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ReasonAction({ label, confirmLabel, onConfirm, pending }: { label: string; confirmLabel: string; onConfirm: (reason: string) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) return <Button variant="danger" onClick={() => setOpen(true)}>{label}</Button>;
  return (
    <div className="w-full space-y-1 rounded border border-bad p-2">
      <FormField label={`Reason (required)`}>
        <textarea autoFocus rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      <div className="flex gap-1.5">
        <Button variant="danger" disabled={!reason.trim() || pending} onClick={() => onConfirm(reason)}>{confirmLabel}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function ScopeEditor({ risk, onDone }: { risk: any; onDone: () => void }) {
  const invalidate = useInvalidateRisk();
  const objects = useQuery({ queryKey: ['control-peers', risk.customer_id, risk.control_id], queryFn: () => api.get(`/api/records/hardening${qs({ customerId: risk.customer_id, pageSize: 500 })}`) });
  const [selected, setSelected] = useState<string[]>(risk.object_ids);
  const rows = (objects.data?.rows ?? []).filter((r: any) => r.control_id === risk.control_id && (r.result === 'failed' || r.result === 'warning' || risk.object_ids.includes(r.object_id)));
  const save = useMutation({
    mutationFn: () => api.post(`/api/risk/${risk.id}/scope`, { objectIds: selected }),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
  });
  return (
    <div className="w-full space-y-1.5 rounded border border-warn p-2">
      <p>Changing the scope of an accepted request sets it to Review required. It then stops covering any object until a new decision is made.</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((r: any) => (
          <label key={r.object_id} className="flex items-center gap-1">
            <input type="checkbox" checked={selected.includes(r.object_id)} onChange={(e) => setSelected((list) => (e.target.checked ? [...list, r.object_id] : list.filter((x) => x !== r.object_id)))} />
            {r.object_name} <StatusBadge value={r.result} />
          </label>
        ))}
      </div>
      {save.isError && <ErrorState error={save.error} />}
      <div className="flex gap-1.5">
        <Button variant="primary" disabled={selected.length === 0 || save.isPending} onClick={() => save.mutate()}>Apply scope change</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export function ApprovalPanel({ data, onOpenRecord }: { data: any; onOpenRecord: (id: string) => void }) {
  const r = data.record;
  const me = useMe();
  const invalidate = useInvalidateRisk();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scoping, setScoping] = useState(false);
  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api.post(`/api/risk/${r.id}/${action}`, body ?? {}),
    onSuccess: async (result, vars) => {
      setConfirming(false);
      await invalidate();
      if (vars.action === 'renew') onOpenRecord(result.id);
    },
  });
  const canDecide = data.canDecide;
  const selfApproval = data.isRequester;

  if (editing) return <RiskAcceptanceForm draft={r} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;

  return (
    <Section title="Decision and actions">
      {r.status === 'pending' && !canDecide && <p className="mb-1.5 text-muted">Waiting for {r.approver_name}. {me.data?.user.role === 'admin' ? 'System Administrator access does not grant approval authority.' : 'You do not hold approval authority for this request.'}</p>}
      <div className="flex flex-wrap items-start gap-1.5">
        {r.status === 'draft' && (
          <>
            <Button onClick={() => setEditing(true)}>Edit draft</Button>
            <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'submit' })}>Submit for approval</Button>
          </>
        )}
        {r.status === 'pending' && canDecide && (
          <>
            {!confirming ? (
              <Button variant="primary" disabled={act.isPending} onClick={() => (selfApproval ? setConfirming(true) : act.mutate({ action: 'approve' }))}>Approve</Button>
            ) : (
              <div role="alertdialog" aria-label="Confirm self-approval" className="w-full space-y-1 rounded border border-warn bg-warn-bg p-2 text-warn">
                <p><strong>This is a self-approval.</strong> You submitted this request. Approving it is allowed for an authorized risk owner, and it will be identified as self-approval in the audit history.</p>
                <div className="flex gap-1.5">
                  <Button variant="primary" disabled={act.isPending} onClick={() => act.mutate({ action: 'approve', body: { confirmSelfApproval: true } })}>Confirm self-approval</Button>
                  <Button onClick={() => setConfirming(false)}>Cancel</Button>
                </div>
              </div>
            )}
            <ReasonAction label="Reject" confirmLabel="Confirm rejection" pending={act.isPending} onConfirm={(reason) => act.mutate({ action: 'reject', body: { reason } })} />
          </>
        )}
        {r.status === 'accepted' && canDecide && <ReasonAction label="Revoke" confirmLabel="Confirm revocation" pending={act.isPending} onConfirm={(reason) => act.mutate({ action: 'revoke', body: { reason } })} />}
        {(r.status === 'accepted' || r.status === 'expired') && <Button disabled={act.isPending} onClick={() => act.mutate({ action: 'renew' })}>Renew as a new request</Button>}
        {r.status === 'accepted' && !scoping && <Button onClick={() => setScoping(true)}>Change affected scope</Button>}
        {scoping && <ScopeEditor risk={r} onDone={() => setScoping(false)} />}
      </div>
      {act.isError && <ErrorState error={act.error} />}
      {['rejected', 'revoked'].includes(r.status) && <p className="mt-1 text-muted">This is a final state. No more changes can be made.</p>}
    </Section>
  );
}

export function riskColumns(onOpen: (id: string) => void): Column<any>[] {
  return [
    { key: 'id', label: 'ID', sortKey: 'id', render: (r) => <RecordLink id={r.id} row={{ ...r, description: r.justification, object_name: r.affected_names }} onOpen={onOpen} /> },
    { key: 'title', label: 'Control', sortKey: 'title', render: (r) => r.title },
    { key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r) => r.customer_name },
    { key: 'objects', label: 'Affected objects', render: (r) => r.affected_names },
    { key: 'status', label: 'Status', sortKey: 'status', render: (r) => (<span className="flex flex-wrap gap-1"><StatusBadge value={r.status} />{r.review_required && r.status === 'accepted' && <StatusBadge value="review_required" />}</span>) },
    { key: 'severity', label: 'Severity', sortKey: 'severity', render: (r) => <StatusBadge value={r.severity} /> },
    { key: 'residual', label: 'Residual', sortKey: 'residual_risk', render: (r) => <StatusBadge value={r.residual_risk} /> },
    { key: 'owner', label: 'Risk owner', sortKey: 'risk_owner_name', render: (r) => r.risk_owner_name },
    { key: 'expiry', label: 'Expiry', sortKey: 'expiry_at', render: (r) => <span className="whitespace-nowrap">{fmtDate(r.expiry_at)}</span> },
    { key: 'review', label: 'Review', sortKey: 'review_at', render: (r) => <span className="whitespace-nowrap">{fmtDate(r.review_at)}</span> },
  ];
}

export function RiskDetails({ data, onOpenRecord }: { data: any; onOpenRecord: (id: string) => void }) {
  const r = data.record;
  return (
    <>
      {r.review_required && r.status === 'accepted' && (
        <p role="alert" className="rounded border border-warn bg-warn-bg p-2 text-warn"><strong>Review required.</strong> {r.review_reason} This acceptance covers no objects until a new decision is made.</p>
      )}
      {r.self_approved && <p className="rounded border border-warn bg-warn-bg p-2 text-warn">Self-approved: the person who decided also submitted this request.</p>}
      <FieldList
        items={[
          ['Status', <StatusBadge value={r.status} />],
          ['Baseline', r.baseline_name],
          ['Control version', `${r.control_version}${r.current_control_version !== r.control_version ? ` (current version: ${r.current_control_version})` : ''}`],
          ['Affected objects', (
            <ul>{r.affected_objects.map((o: any) => <li key={o.id}>{o.name}{!o.approved_scope && <span className="text-warn"> (added after the decision, not covered)</span>}</li>)}</ul>
          )],
          ['Evidence', r.evidence],
          ['Business justification', r.justification],
          ['Risk severity', <StatusBadge value={r.severity} />],
          ['Residual risk', <StatusBadge value={r.residual_risk} />],
          ['Compensating controls', r.compensating_controls],
          ['Risk owner', r.risk_owner_name],
          ['Designated approver', r.approver_name],
          ['Requested by', r.requester_name],
          ['Decided by', r.decision_by_name ?? 'No decision yet'],
          ['Decision time', r.decision_at ? fmtDateTime(r.decision_at) : 'No decision yet'],
          ...(r.decision_reason ? ([['Reason', r.decision_reason]] as [string, string][]) : []),
          ['Review date', fmtDate(r.review_at)],
          ['Expiry date', fmtDate(r.expiry_at)],
          ['Remediation', r.remediation],
        ]}
      />
      {r.renewed_from_id && <p>Renewal of <button type="button" className="text-primary underline" onClick={() => onOpenRecord(r.renewed_from_id)}>{r.renewed_from_id}</button>. That request and its decision are unchanged.</p>}
      {data.renewals.length > 0 && (
        <p>Renewed by {data.renewals.map((x: any) => <button key={x.id} type="button" className="mr-1 text-primary underline" onClick={() => onOpenRecord(x.id)}>{x.id}</button>)}</p>
      )}
    </>
  );
}
