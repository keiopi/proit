import type { SlaStatus } from './sla';

const SEVERITY_POINTS: Record<string, number> = { critical: 40, high: 30, warning: 20, medium: 20, low: 10 };
const IMPACT_POINTS: Record<string, number> = { critical: 30, high: 20, medium: 10, low: 5 };
const SLA_POINTS: Record<SlaStatus, number> = { breached: 30, at_risk: 20, unknown: 15, met: 0 };

export interface PriorityFactor {
  factor: 'Severity' | 'Service impact' | 'Customer SLA';
  value: string;
  points: number;
}

export interface PriorityResult {
  score: number;
  factors: PriorityFactor[];
}

/** Adds severity, affected service criticality and SLA position into a 0-100 score. */
export function prioritize(severity: string, serviceCriticality: string | null, sla: SlaStatus): PriorityResult {
  const factors: PriorityFactor[] = [
    { factor: 'Severity', value: severity, points: SEVERITY_POINTS[severity] ?? 10 },
    { factor: 'Service impact', value: serviceCriticality ?? 'no linked service', points: serviceCriticality ? (IMPACT_POINTS[serviceCriticality] ?? 5) : 0 },
    { factor: 'Customer SLA', value: sla, points: SLA_POINTS[sla] },
  ];
  return { score: factors.reduce((sum, f) => sum + f.points, 0), factors };
}
