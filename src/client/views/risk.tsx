import { Link } from 'react-router-dom';
import { AuditHistory, RecordDrawer } from '../components/DetailDrawer';
import { EntityTable, useEntityList } from '../components/EntityTable';
import { FilterBar } from '../components/FilterBar';
import { ReminderSettings } from '../components/ReminderSettings';
import { ApprovalPanel, RiskDetails, riskColumns } from '../components/risk';
import { PageHeader } from '../components/ui';
import { useCarry, useFilters, type Filters } from '../lib/hooks';

const BUCKETS = [['', 'All'], ['active', 'Active'], ['pending', 'Pending'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['review_required', 'Review required']];

export function ExceptionRegister({ filters }: { filters: Filters }) {
  const query = useEntityList('risk', filters);
  const open = (id: string) => filters.set('record', id);
  return (
    <>
      <FilterBar filters={filters} viewKey="risk" fields={['search', 'service', 'object', 'os', 'severity', 'status']} facets={query.data?.facets} />
      <EntityTable query={query} filters={filters} columns={riskColumns(open)} caption="Exception register" />
    </>
  );
}

export function RiskView() {
  const filters = useFilters('risk');
  const carry = useCarry();
  const v = filters.values;
  const open = (id: string) => filters.set('record', id);
  return (
    <>
      <PageHeader
        title="Risk Acceptances"
        description="Accepted risk never changes a Failed or Warning result, and never improves the compliance score."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <ReminderSettings customerId={v.customerId} field="risk_days" label="Risk reminder days" />
            <Link className="text-xs text-primary underline" to={carry('/hardening', { status: 'failed' })}>Start from a failed control</Link>
          </span>
        }
      />
      <div role="group" aria-label="Exception state" className="mb-2 flex flex-wrap gap-1">
        {BUCKETS.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={(v.bucket ?? '') === value} onClick={() => filters.set('bucket', value || null)} className={`rounded border px-2 py-1 text-xs ${(v.bucket ?? '') === value ? 'border-primary bg-accent-bg font-semibold text-primary' : 'border-line bg-surface hover:border-primary'}`}>
            {label}
          </button>
        ))}
      </div>
      <ExceptionRegister filters={filters} />
      <RecordDrawer entity="risk" id={v.record ?? null} onClose={() => filters.set('record', null)} title={(r) => r.title} wide>
        {(data) => (
          <>
            <RiskDetails data={data} onOpenRecord={open} />
            <ApprovalPanel data={data} onOpenRecord={open} />
            <AuditHistory audit={data.audit} />
          </>
        )}
      </RecordDrawer>
    </>
  );
}
