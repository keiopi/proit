export type LifecycleStatus = 'supported' | 'approaching' | 'unsupported' | 'unknown';

export const LIFECYCLE_APPROACHING_DAYS = 180;
const DAY_MS = 86_400_000;

export interface LifecycleInput {
  eos_at: string | Date | null;
  date_verified: boolean;
}

export interface LifecycleEvaluation {
  status: LifecycleStatus;
  /** Whole days until the deciding deadline. Negative when past, null when Unknown. */
  days_remaining: number | null;
  deciding_deadline: string | null;
  status_reason: string;
}

/**
 * Status is decided only by a verified end-of-support date. End of life and
 * extended support are shown separately and are never used in its place.
 */
export function evaluateLifecycle(input: LifecycleInput, now: Date, approachingDays = LIFECYCLE_APPROACHING_DAYS): LifecycleEvaluation {
  if (!input.eos_at) {
    return { status: 'unknown', days_remaining: null, deciding_deadline: null, status_reason: 'No end-of-support date is on record' };
  }
  if (!input.date_verified) {
    return { status: 'unknown', days_remaining: null, deciding_deadline: null, status_reason: 'The end-of-support date has not been verified' };
  }
  const deadline = new Date(input.eos_at);
  const days = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
  const iso = deadline.toISOString();
  if (deadline.getTime() <= now.getTime()) {
    return { status: 'unsupported', days_remaining: days, deciding_deadline: iso, status_reason: 'The verified end-of-support date has passed' };
  }
  if (days <= approachingDays) {
    return { status: 'approaching', days_remaining: days, deciding_deadline: iso, status_reason: `The verified end-of-support date is within ${approachingDays} days` };
  }
  return { status: 'supported', days_remaining: days, deciding_deadline: iso, status_reason: 'The verified end-of-support date is more than the notice period away' };
}
