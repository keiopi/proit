export type PeriodKey = 'current_month' | 'previous_month' | 'quarter' | 'year' | 'custom';

export interface Period {
  key: PeriodKey;
  /** Inclusive start. */
  start: Date;
  /** Exclusive end. */
  end: Date;
  label: string;
  timezone: 'UTC';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));

export function resolvePeriod(key: PeriodKey, now: Date, from?: string, to?: string): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (key) {
    case 'previous_month': {
      const start = utc(y, m - 1);
      return { key, start, end: utc(y, m), label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`, timezone: 'UTC' };
    }
    case 'quarter': {
      const q = Math.floor(m / 3);
      return { key, start: utc(y, q * 3), end: utc(y, q * 3 + 3), label: `Q${q + 1} ${y}`, timezone: 'UTC' };
    }
    case 'year':
      return { key, start: utc(y, 0), end: utc(y + 1, 0), label: `${y}`, timezone: 'UTC' };
    case 'custom': {
      const start = from ? new Date(`${from.slice(0, 10)}T00:00:00.000Z`) : utc(y, m);
      const inclusiveEnd = to ? new Date(`${to.slice(0, 10)}T00:00:00.000Z`) : utc(y, m, now.getUTCDate());
      if (Number.isNaN(start.getTime()) || Number.isNaN(inclusiveEnd.getTime())) {
        throw new RangeError('Invalid custom period dates');
      }
      if (inclusiveEnd < start) throw new RangeError('Custom period end is before its start');
      // The chosen end date is included, so the exclusive boundary is the next midnight.
      const end = new Date(inclusiveEnd.getTime() + 86_400_000);
      return { key, start, end, label: `${start.toISOString().slice(0, 10)} to ${inclusiveEnd.toISOString().slice(0, 10)}`, timezone: 'UTC' };
    }
    case 'current_month':
    default:
      return { key: 'current_month', start: utc(y, m), end: utc(y, m + 1), label: `${MONTHS[m]} ${y}`, timezone: 'UTC' };
  }
}

/** Calendar months ending with the month containing `now`, oldest first. */
export function trailingMonths(now: Date, count: number): Period[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const months: Period[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = utc(y, m - i);
    months.push({
      key: 'custom',
      start,
      end: utc(y, m - i + 1),
      label: `${MONTHS[start.getUTCMonth()]} ${String(start.getUTCFullYear()).slice(2)}`,
      timezone: 'UTC',
    });
  }
  return months;
}
