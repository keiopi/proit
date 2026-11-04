export type SlaStatus = 'met' | 'at_risk' | 'breached' | 'unknown';

/** A result within this many percentage points above target counts as At risk. */
export const SLA_AT_RISK_MARGIN = 0.05;

export function slaStatus(value: number | null, target: number): SlaStatus {
  if (value === null) return 'unknown';
  if (value < target) return 'breached';
  if (value < target + SLA_AT_RISK_MARGIN) return 'at_risk';
  return 'met';
}

export interface SlaMember {
  id: string;
  name: string;
  weight: number;
  included: boolean;
  value: number | null;
}

export interface SlaContribution extends SlaMember {
  normalizedWeight: number | null;
  contribution: number | null;
}

export interface SlaAggregate {
  /** Null when any included member is Unknown or nothing is included. */
  value: number | null;
  completeness: 'complete' | 'incomplete' | 'empty';
  contributions: SlaContribution[];
  /** Sum of normalized weight x value over the known members. Not an SLA result by itself. */
  knownContribution: number;
  knownWeightShare: number;
  missingWeightShare: number;
}

/**
 * Weighted mean over the included members.
 *
 * Weights are normalized over every included member, including Unknown ones, so
 * the weight of a missing member is reported as missing and never redistributed.
 */
export function aggregateSla(members: SlaMember[]): SlaAggregate {
  const included = members.filter((m) => m.included);
  const totalWeight = included.reduce((sum, m) => sum + m.weight, 0);

  const contributions: SlaContribution[] = members.map((m) => {
    if (!m.included || totalWeight <= 0) return { ...m, normalizedWeight: null, contribution: null };
    const normalizedWeight = m.weight / totalWeight;
    return { ...m, normalizedWeight, contribution: m.value === null ? null : normalizedWeight * m.value };
  });

  const known = contributions.filter((c) => c.included && c.value !== null);
  const knownContribution = known.reduce((sum, c) => sum + (c.contribution ?? 0), 0);
  const knownWeightShare = known.reduce((sum, c) => sum + (c.normalizedWeight ?? 0), 0);
  const empty = included.length === 0 || totalWeight <= 0;
  const complete = !empty && known.length === included.length;

  return {
    value: complete ? knownContribution : null,
    completeness: empty ? 'empty' : complete ? 'complete' : 'incomplete',
    contributions,
    knownContribution,
    knownWeightShare,
    missingWeightShare: empty ? 0 : 1 - knownWeightShare,
  };
}
