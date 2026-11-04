/** All timestamps display in UTC, the same zone used for reporting boundaries. */
export function fmtDateTime(value: unknown): string {
  if (!value) return 'Not available';
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return 'Not available';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function fmtDate(value: unknown): string {
  if (!value) return 'Not available';
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) return 'Not available';
  return d.toISOString().slice(0, 10);
}

export const toDateInput = (value: unknown) => (value ? new Date(value as string).toISOString().slice(0, 10) : '');

export function fmtPct(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined ? 'Unknown' : `${value.toFixed(digits)}%`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'Unknown';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export const humanize = (value: unknown) => String(value ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const ROLE_LABEL: Record<string, string> = { customer: 'Customer', manager: 'Customer Manager', admin: 'System Administrator' };
