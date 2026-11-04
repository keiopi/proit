import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as RadixHover from '@radix-ui/react-hover-card';
import { AlertCircle, AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, Clock, Info, Loader2, MinusCircle, RefreshCw, ShieldAlert, ShieldCheck, XCircle, type LucideIcon } from 'lucide-react';
import { humanize } from '../lib/format';

export function Loader({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-muted">
      <Loader2 size={16} className="animate-spin" aria-hidden /> {label}...
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 p-8 text-center">
      <CircleDashed size={20} className="text-muted" aria-hidden />
      <p className="font-medium">{title}</p>
      {hint && <p className="text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Retrying cannot change a not-found or validation answer. */
const isClientError = (error: unknown) => {
  const status = (error as { status?: number })?.status;
  return status !== undefined && status >= 400 && status < 500;
};

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-3 flex flex-wrap items-center gap-3 rounded border border-bad bg-bad-bg p-3 text-bad">
      <AlertCircle size={16} aria-hidden />
      <span className="flex-1">{(error as Error)?.message ?? 'Something went wrong'}</span>
      {onRetry && !isClientError(error) && (
        <Button onClick={onRetry}>
          <RefreshCw size={12} aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

export function Unavailable({ children = 'Unknown' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-unknown">
      <CircleHelp size={12} aria-hidden /> {children}
    </span>
  );
}

type Variant = 'default' | 'primary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  default: 'border-line bg-surface-2 text-fg hover:border-primary',
  primary: 'border-primary-strong bg-primary-strong text-on-primary hover:opacity-90',
  danger: 'border-bad text-bad bg-transparent hover:bg-bad-bg',
  ghost: 'border-transparent bg-transparent text-fg hover:bg-surface-2',
};

export function Button({ variant = 'default', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${VARIANTS[variant]} ${className}`} />;
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'unknown' | 'accent';
const TONES: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-info-bg text-info',
  unknown: 'bg-unknown-bg text-unknown',
  accent: 'bg-accent-bg text-primary',
};

const BAD: [Tone, LucideIcon] = ['bad', XCircle];
const WARN: [Tone, LucideIcon] = ['warn', AlertTriangle];
const OK: [Tone, LucideIcon] = ['ok', CheckCircle2];
const INFO: [Tone, LucideIcon] = ['info', Info];
const UNKNOWN: [Tone, LucideIcon] = ['unknown', CircleHelp];
const NEUTRAL: [Tone, LucideIcon] = ['unknown', MinusCircle];
const WAIT: [Tone, LucideIcon] = ['accent', Clock];

const STATUS: Record<string, [Tone, LucideIcon, string?]> = {
  critical: [...BAD, 'Critical'], high: [...WARN, 'High'], warning: [...WARN, 'Warning'], medium: [...INFO, 'Medium'], low: [...NEUTRAL, 'Low'],
  open: [...WARN, 'Open'], in_progress: [...INFO, 'In progress'], pending_customer: [...WAIT, 'Pending customer'], resolved: [...OK, 'Resolved'], closed: [...NEUTRAL, 'Closed'],
  todo: [...NEUTRAL, 'To do'], in_review: [...WAIT, 'In review'], done: [...OK, 'Done'], planned: [...NEUTRAL, 'Planned'], opened: [...WARN, 'Opened'],
  merged: [...OK, 'Merged'], failed: [...BAD, 'Failed'], success: [...OK, 'Success'],
  active: [...BAD, 'Active'], acknowledged: [...WAIT, 'Acknowledged'], mitigating: [...INFO, 'Mitigating'],
  passed: [...OK, 'Passed'], not_applicable: [...NEUTRAL, 'Not applicable'], not_checked: [...UNKNOWN, 'Not checked'],
  met: [...OK, 'SLA met'], at_risk: [...WARN, 'SLA at risk'], breached: [...BAD, 'SLA breached'], unknown: [...UNKNOWN, 'Unknown'],
  healthy: [...OK, 'Healthy'], degraded: [...WARN, 'Degraded'], down: [...BAD, 'Down'], up: [...OK, 'Up'], maintenance: [...INFO, 'Maintenance'],
  supported: [...OK, 'Supported'], approaching: [...WARN, 'Approaching end of support'], unsupported: [...BAD, 'Unsupported'],
  surplus: [...OK, 'Surplus'], balanced: [...INFO, 'Balanced'], potential_shortfall: [...BAD, 'Potential shortfall'], missing_data: [...UNKNOWN, 'Missing measurement'],
  draft: [...NEUTRAL, 'Draft'], pending: [...WAIT, 'Pending approval'], accepted: ['ok', ShieldCheck, 'Accepted'], rejected: [...BAD, 'Rejected'], expired: [...NEUTRAL, 'Expired'], revoked: ['bad', ShieldAlert, 'Revoked'],
  review_required: [...WARN, 'Review required'], none: [...NEUTRAL, 'No acceptance'], none_active: [...NEUTRAL, 'No active acceptance'],
};

export function StatusBadge({ value, label }: { value: string | null | undefined; label?: string }) {
  const key = value ?? 'unknown';
  const def = STATUS[key];
  const tone = def?.[0] ?? 'unknown';
  const Icon = def?.[1] ?? Info;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>
      <Icon size={11} aria-hidden /> {label ?? def?.[2] ?? humanize(key)}
    </span>
  );
}

export const statusLabel = (value: string) => STATUS[value]?.[2] ?? humanize(value);

const KPI_ACCENT: Record<string, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', unknown: 'text-unknown', default: 'text-fg' };

export function KpiCard({ label, value, sub, to, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; to: string; tone?: keyof typeof KPI_ACCENT }) {
  return (
    <Link to={to} className="block rounded border border-line bg-surface p-2.5 hover:border-primary">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-0.5 text-xl font-semibold ${KPI_ACCENT[tone]}`}>{value}</div>
      {sub && <div className="num mt-0.5 text-[11px] text-muted">{sub}</div>}
    </Link>
  );
}

/** Supplementary preview only. Every value shown here is also available in the record drawer. */
export function HoverCard({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <RadixHover.Root openDelay={250} closeDelay={80}>
      <RadixHover.Trigger asChild>{trigger}</RadixHover.Trigger>
      <RadixHover.Portal>
        <RadixHover.Content sideOffset={4} align="start" className="z-50 max-w-xs rounded border border-line bg-surface-2 p-2.5 text-xs shadow-lg">
          {children}
        </RadixHover.Content>
      </RadixHover.Portal>
    </RadixHover.Root>
  );
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-base font-semibold">{title}</h1>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function FieldList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="num min-w-0 break-words">{value === null || value === undefined || value === '' ? <Unavailable>Not available</Unavailable> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-2">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}
