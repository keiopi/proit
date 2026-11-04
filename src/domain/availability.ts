export interface Interval {
  start: number;
  end: number;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const left = mergeIntervals(a);
  const right = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (end > start) out.push({ start, end });
    if (left[i].end < right[j].end) i++;
    else j++;
  }
  return out;
}

export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const remove = mergeIntervals(b);
  const out: Interval[] = [];
  for (const interval of mergeIntervals(a)) {
    let cursor = interval.start;
    for (const r of remove) {
      if (r.end <= cursor || r.start >= interval.end) continue;
      if (r.start > cursor) out.push({ start: cursor, end: r.start });
      cursor = Math.max(cursor, r.end);
    }
    if (cursor < interval.end) out.push({ start: cursor, end: interval.end });
  }
  return out;
}

export const totalDuration = (intervals: Interval[]) => intervals.reduce((sum, i) => sum + (i.end - i.start), 0);

/** Below this share of monitored time an object's availability is reported as Unknown. */
export const MIN_MONITORING_COVERAGE = 0.8;

export interface AvailabilityInput {
  start: number;
  end: number;
  now: number;
  coverage: Interval[];
  outages: Interval[];
  maintenance: Interval[];
  excludeMaintenance: boolean;
}

export interface AvailabilityResult {
  /** Null means Unknown. It is never defaulted to 100. */
  availability: number | null;
  reportingMs: number;
  monitoredMs: number;
  eligibleMs: number;
  countedDowntimeMs: number;
  plannedDowntimeMs: number;
  unplannedDowntimeMs: number;
  outageCount: number;
  dataCoverage: number;
  unknownReason: string | null;
}

/**
 * Object availability = (eligible monitored duration - counted downtime) / eligible monitored duration x 100.
 *
 * With maintenance excluded, maintenance time leaves both the eligible duration and the downtime.
 * With it included, maintenance stays eligible and counts as downtime. Overlapping outages are merged first.
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const end = Math.min(input.end, input.now);
  const reporting: Interval[] = [{ start: input.start, end }];
  const reportingMs = Math.max(0, end - input.start);

  const monitored = intersectIntervals(reporting, input.coverage);
  const monitoredMs = totalDuration(monitored);
  const dataCoverage = reportingMs > 0 ? monitoredMs / reportingMs : 0;

  const outages = intersectIntervals(input.outages, monitored);
  const planned = intersectIntervals(input.maintenance, monitored);
  const plannedDowntimeMs = totalDuration(planned);

  const eligible = input.excludeMaintenance ? subtractIntervals(monitored, planned) : monitored;
  const eligibleMs = totalDuration(eligible);
  const unplanned = subtractIntervals(outages, planned);
  const counted = input.excludeMaintenance ? unplanned : mergeIntervals([...outages, ...planned]);
  const countedDowntimeMs = totalDuration(counted);

  const base = {
    reportingMs,
    monitoredMs,
    eligibleMs,
    countedDowntimeMs,
    plannedDowntimeMs,
    unplannedDowntimeMs: totalDuration(unplanned),
    outageCount: unplanned.length,
    dataCoverage,
  };

  if (reportingMs === 0) return { ...base, availability: null, unknownReason: 'The reporting period has not started' };
  if (monitoredMs === 0) return { ...base, availability: null, unknownReason: 'No monitoring data in this period' };
  if (dataCoverage < MIN_MONITORING_COVERAGE) {
    return {
      ...base,
      availability: null,
      unknownReason: `Monitoring coverage ${(dataCoverage * 100).toFixed(1)}% is below the ${MIN_MONITORING_COVERAGE * 100}% minimum`,
    };
  }
  if (eligibleMs === 0) return { ...base, availability: null, unknownReason: 'No eligible monitored time after maintenance exclusions' };

  return { ...base, availability: ((eligibleMs - countedDowntimeMs) / eligibleMs) * 100, unknownReason: null };
}
