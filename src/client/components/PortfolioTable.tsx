import { useLocalSort } from '../lib/hooks';
import { fmtPct } from '../lib/format';
import { Column, DataTable } from './DataTable';
import { EmptyState, StatusBadge, Unavailable } from './ui';

export function PortfolioTable({ rows, onSelect, showCustomer, nameLabel = 'Service' }: { rows: any[]; onSelect: (row: any) => void; showCustomer?: boolean; nameLabel?: string }) {
  const { sorted, sort, dir, onSort } = useLocalSort(rows, 'name', 'asc');
  if (rows.length === 0) return <EmptyState title="Nothing in this part of your portfolio" />;
  const columns: Column<any>[] = [
    {
      key: 'name', label: nameLabel, sortKey: 'name',
      render: (r) => <button type="button" onClick={() => onSelect(r)} className="font-medium text-primary underline-offset-2 hover:underline">{r.name}</button>,
    },
    ...(showCustomer ? [{ key: 'customer', label: 'Customer', sortKey: 'customer_name', render: (r: any) => r.customer_name }] : []),
    { key: 'health', label: 'Health', sortKey: 'health', render: (r) => <StatusBadge value={r.health} /> },
    { key: 'sla', label: r0(rows), sortKey: 'sla_value', align: 'right', render: (r) => (r.sla_value === null ? <Unavailable /> : fmtPct(r.sla_value)) },
    { key: 'target', label: 'Target', sortKey: 'sla_target', align: 'right', render: (r) => `${r.sla_target}%` },
    { key: 'status', label: 'SLA status', sortKey: 'sla_status', render: (r) => <StatusBadge value={r.sla_status} /> },
    { key: 'inc', label: 'Incidents', sortKey: 'open_incidents', align: 'right', render: (r) => r.open_incidents },
    { key: 'req', label: 'Requests', sortKey: 'open_requests', align: 'right', render: (r) => r.open_requests },
    { key: 'crit', label: 'Critical alarms', sortKey: 'critical_alarms', align: 'right', render: (r) => r.critical_alarms },
    { key: 'warn', label: 'Warnings', sortKey: 'warning_alarms', align: 'right', render: (r) => r.warning_alarms },
    { key: 'vuln', label: 'Critical vulns', sortKey: 'critical_vulns', align: 'right', render: (r) => r.critical_vulns },
    { key: 'hard', label: 'Hardening', sortKey: 'hardening_score', align: 'right', render: (r) => (r.hardening_score === null ? <Unavailable>No evaluated controls</Unavailable> : `${r.hardening_score.toFixed(1)}%`) },
  ];
  return <DataTable caption="Portfolio" columns={columns} rows={sorted} rowKey={(r) => r.id} sort={sort} dir={dir} onSort={onSort} />;
}

/** A system shows its lowest object, because systems have no SLA result of their own. */
const r0 = (rows: any[]) => (rows[0]?.level === 'system' ? 'Lowest object' : 'Availability');
