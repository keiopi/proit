import { describe, expect, it } from 'vitest';
import { computeAvailability, mergeIntervals } from '../src/domain/availability';
import { aggregateSla, slaStatus } from '../src/domain/sla';
import { scoreHardening } from '../src/domain/hardening';
import { evaluateLifecycle } from '../src/domain/lifecycle';
import { areComparable, evaluateLicense, summarizeLicenses, type LicenseInput } from '../src/domain/license';
import { assertTransition, canTransition, isExpiredNow, RiskTransitionError } from '../src/domain/riskStateMachine';
import { resolvePeriod } from '../src/domain/periods';
import { prioritize } from '../src/domain/priority';
import { reachedThreshold } from '../src/server/repos/notifications';

const NOW = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;

describe('availability', () => {
  const base = { start: 0, end: 100 * H, now: 100 * H, coverage: [{ start: 0, end: 100 * H }], outages: [], maintenance: [], excludeMaintenance: true };

  it('applies the object availability formula', () => {
    const r = computeAvailability({ ...base, outages: [{ start: 10 * H, end: 11 * H }] });
    expect(r.availability).toBeCloseTo(99, 10);
    expect(r.outageCount).toBe(1);
  });

  it('does not double-count overlapping outages', () => {
    expect(mergeIntervals([{ start: 0, end: 5 }, { start: 3, end: 8 }, { start: 10, end: 12 }])).toEqual([{ start: 0, end: 8 }, { start: 10, end: 12 }]);
    const r = computeAvailability({ ...base, outages: [{ start: 10 * H, end: 12 * H }, { start: 11 * H, end: 13 * H }] });
    expect(r.countedDowntimeMs).toBe(3 * H);
    expect(r.availability).toBeCloseTo(97, 10);
  });

  it('excludes maintenance from both numerator and denominator', () => {
    const r = computeAvailability({ ...base, maintenance: [{ start: 0, end: 20 * H }], outages: [{ start: 10 * H, end: 30 * H }] });
    expect(r.eligibleMs).toBe(80 * H);
    expect(r.countedDowntimeMs).toBe(10 * H);
    expect(r.availability).toBeCloseTo((70 / 80) * 100, 10);
  });

  it('counts maintenance as downtime when the rule is off, without double counting overlap', () => {
    const r = computeAvailability({ ...base, excludeMaintenance: false, maintenance: [{ start: 0, end: 20 * H }], outages: [{ start: 10 * H, end: 30 * H }] });
    expect(r.eligibleMs).toBe(100 * H);
    expect(r.countedDowntimeMs).toBe(30 * H);
    expect(r.availability).toBeCloseTo(70, 10);
  });

  it('reports missing monitoring as Unknown and never 100%', () => {
    const none = computeAvailability({ ...base, coverage: [] });
    expect(none.availability).toBeNull();
    expect(none.unknownReason).toMatch(/No monitoring/);
    const low = computeAvailability({ ...base, coverage: [{ start: 0, end: 50 * H }] });
    expect(low.availability).toBeNull();
    expect(low.dataCoverage).toBeCloseTo(0.5);
  });

  it('caps the period at now', () => {
    const r = computeAvailability({ ...base, end: 1000 * H, outages: [{ start: 0, end: 1 * H }] });
    expect(r.reportingMs).toBe(100 * H);
    expect(r.availability).toBeCloseTo(99, 10);
  });
});

describe('SLA aggregation', () => {
  it('computes a weighted mean with normalized contributions', () => {
    const r = aggregateSla([
      { id: 'a', name: 'a', weight: 3, included: true, value: 99 },
      { id: 'b', name: 'b', weight: 1, included: true, value: 95 },
      { id: 'c', name: 'c', weight: 5, included: false, value: 10 },
    ]);
    expect(r.value).toBeCloseTo(98, 10);
    expect(r.contributions[0].normalizedWeight).toBeCloseTo(0.75);
    expect(r.contributions[2].normalizedWeight).toBeNull();
    expect(r.completeness).toBe('complete');
  });

  it('does not redistribute the weight of a missing member', () => {
    const r = aggregateSla([
      { id: 'a', name: 'a', weight: 1, included: true, value: 99 },
      { id: 'b', name: 'b', weight: 1, included: true, value: null },
    ]);
    expect(r.value).toBeNull();
    expect(r.completeness).toBe('incomplete');
    expect(r.contributions[0].normalizedWeight).toBe(0.5);
    expect(r.knownContribution).toBeCloseTo(49.5);
    expect(r.missingWeightShare).toBeCloseTo(0.5);
  });

  it('reports nothing included as empty', () => {
    expect(aggregateSla([{ id: 'a', name: 'a', weight: 1, included: false, value: 99 }]).completeness).toBe('empty');
  });

  it('classifies SLA status', () => {
    expect(slaStatus(null, 99.9)).toBe('unknown');
    expect(slaStatus(99.8, 99.9)).toBe('breached');
    expect(slaStatus(99.92, 99.9)).toBe('at_risk');
    expect(slaStatus(99.99, 99.9)).toBe('met');
  });
});

describe('hardening score', () => {
  it('uses Passed / (Passed + Failed + Warning)', () => {
    const s = scoreHardening({ passed: 6, failed: 1, warning: 1, not_applicable: 5, not_checked: 2 });
    expect(s.denominator).toBe(8);
    expect(s.score).toBe(75);
    expect(s.coverage).toBe(80);
  });
  it('returns no score when nothing was evaluated', () => {
    const s = scoreHardening({ passed: 0, failed: 0, warning: 0, not_applicable: 3, not_checked: 2 });
    expect(s.score).toBeNull();
    expect(s.denominator).toBe(0);
  });
});

describe('lifecycle', () => {
  const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
  it('gives Unknown for a missing date and never infers one', () => {
    const r = evaluateLifecycle({ eos_at: null, date_verified: true }, NOW);
    expect(r.status).toBe('unknown');
    expect(r.days_remaining).toBeNull();
    expect(r.deciding_deadline).toBeNull();
  });
  it('gives Unknown for an unverified date', () => {
    expect(evaluateLifecycle({ eos_at: day(500), date_verified: false }, NOW).status).toBe('unknown');
  });
  it('classifies verified dates', () => {
    expect(evaluateLifecycle({ eos_at: day(500), date_verified: true }, NOW).status).toBe('supported');
    expect(evaluateLifecycle({ eos_at: day(90), date_verified: true }, NOW).status).toBe('approaching');
    const past = evaluateLifecycle({ eos_at: day(-10), date_verified: true }, NOW);
    expect(past.status).toBe('unsupported');
    expect(past.days_remaining).toBe(-10);
  });
});

describe('licenses', () => {
  const base: LicenseInput = { unit: 'core', contractual_scope: 'DC', entitlement: 100, assigned: 90, consumption: 120, measured_at: NOW, completeness: 100, renewal_at: new Date(NOW.getTime() + 30 * 86_400_000) };

  it('reports over-use as a potential shortfall', () => {
    const r = evaluateLicense(base, NOW);
    expect(r.state).toBe('potential_shortfall');
    expect(r.potential_shortfall).toBe(20);
    expect(r.available_balance).toBe(-20);
    expect(r.assigned_balance).toBe(10);
    expect(r.renewal_upcoming).toBe(true);
  });

  it('flags a missing measurement rather than treating it as zero', () => {
    const r = evaluateLicense({ ...base, consumption: null, measured_at: null }, NOW);
    expect(r.state).toBe('missing_data');
    expect(r.available_balance).toBeNull();
    expect(r.potential_shortfall).toBeNull();
  });

  it('never compares or sums across incompatible units or scopes', () => {
    expect(areComparable(base, { unit: 'user', contractual_scope: 'DC' })).toBe(false);
    expect(areComparable(base, { unit: 'core', contractual_scope: 'Other' })).toBe(false);
    expect(areComparable(base, { unit: 'core', contractual_scope: 'DC' })).toBe(true);
    const groups = summarizeLicenses([base, { ...base, unit: 'user' }, { ...base, contractual_scope: 'Other' }, { ...base }]);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.unit === 'core' && g.contractual_scope === 'DC')!.entitlement).toBe(200);
  });

  it('keeps unmeasured records out of measured totals', () => {
    const [g] = summarizeLicenses([base, { ...base, consumption: null, measured_at: null }]);
    expect(g.missing_measurements).toBe(1);
    expect(g.consumption).toBe(120);
    expect(g.measured_entitlement).toBe(100);
    expect(g.entitlement).toBe(200);
  });
});

describe('risk state machine', () => {
  it('allows only the defined transitions', () => {
    expect(canTransition('draft', 'pending')).toBe(true);
    expect(canTransition('pending', 'accepted')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('accepted', 'expired')).toBe(true);
    expect(canTransition('accepted', 'revoked')).toBe(true);
    expect(canTransition('draft', 'accepted')).toBe(false);
    expect(canTransition('rejected', 'accepted')).toBe(false);
    expect(canTransition('expired', 'accepted')).toBe(false);
    expect(canTransition('revoked', 'accepted')).toBe(false);
  });
  it('requires a reason for rejection and revocation', () => {
    expect(() => assertTransition('pending', 'rejected', ' ')).toThrow(RiskTransitionError);
    expect(() => assertTransition('accepted', 'revoked')).toThrow(RiskTransitionError);
    expect(() => assertTransition('pending', 'rejected', 'No')).not.toThrow();
  });
  it('evaluates expiry against the given date', () => {
    expect(isExpiredNow('accepted', new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(isExpiredNow('accepted', new Date(NOW.getTime() + 1), NOW)).toBe(false);
    expect(isExpiredNow('draft', new Date(NOW.getTime() - 1), NOW)).toBe(false);
  });
});

describe('periods', () => {
  it('uses half-open UTC boundaries', () => {
    const p = resolvePeriod('current_month', NOW);
    expect(p.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    const prev = resolvePeriod('previous_month', NOW);
    expect(prev.end).toEqual(p.start);
    expect(resolvePeriod('quarter', NOW).start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(resolvePeriod('year', NOW).end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('includes the chosen end date of a custom range and rejects inverted ranges', () => {
    const p = resolvePeriod('custom', NOW, '2026-10-05', '2026-10-06');
    expect(p.end.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(() => resolvePeriod('custom', NOW, '2026-10-06', '2026-10-05')).toThrow(RangeError);
  });
});

describe('priority and reminders', () => {
  it('explains the score through its factors', () => {
    const p = prioritize('critical', 'critical', 'breached');
    expect(p.score).toBe(100);
    expect(p.factors.map((f) => f.factor)).toEqual(['Severity', 'Service impact', 'Customer SLA']);
    expect(prioritize('low', 'low', 'met').score).toBeLessThan(p.score);
  });
  it('picks the smallest threshold reached', () => {
    expect(reachedThreshold(10, [30, 14, 7])).toBe(14);
    expect(reachedThreshold(40, [30, 14, 7])).toBeNull();
    expect(reachedThreshold(-1, [30, 14, 7])).toBeNull();
  });
});
