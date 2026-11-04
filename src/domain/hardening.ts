export type ControlResult = 'passed' | 'failed' | 'warning' | 'not_applicable' | 'not_checked';

export interface HardeningTally {
  passed: number;
  failed: number;
  warning: number;
  not_applicable: number;
  not_checked: number;
}

export interface HardeningScore extends HardeningTally {
  /** Passed + Failed + Warning. */
  denominator: number;
  /** Null renders as "No evaluated controls". */
  score: number | null;
  /** Share of applicable controls that were scanned. Null when nothing is applicable. */
  coverage: number | null;
}

export const emptyTally = (): HardeningTally => ({ passed: 0, failed: 0, warning: 0, not_applicable: 0, not_checked: 0 });

export function tally(results: ControlResult[]): HardeningTally {
  const t = emptyTally();
  for (const r of results) t[r]++;
  return t;
}

/**
 * Score = Passed / (Passed + Failed + Warning).
 *
 * This takes only technical results. Risk acceptances are not an input, so an
 * accepted exception cannot improve the score.
 */
export function scoreHardening(t: HardeningTally): HardeningScore {
  const denominator = t.passed + t.failed + t.warning;
  const applicable = denominator + t.not_checked;
  return {
    ...t,
    denominator,
    score: denominator > 0 ? (t.passed / denominator) * 100 : null,
    coverage: applicable > 0 ? (denominator / applicable) * 100 : null,
  };
}
