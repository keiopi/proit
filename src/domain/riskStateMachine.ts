export type RiskStatus = 'draft' | 'pending' | 'accepted' | 'rejected' | 'expired' | 'revoked';

export const RISK_TRANSITIONS: Record<RiskStatus, RiskStatus[]> = {
  draft: ['pending'],
  pending: ['accepted', 'rejected'],
  accepted: ['expired', 'revoked'],
  rejected: [],
  expired: [],
  revoked: [],
};

export const REASON_REQUIRED: RiskStatus[] = ['rejected', 'revoked'];

export class RiskTransitionError extends Error {}

export function canTransition(from: RiskStatus, to: RiskStatus): boolean {
  return RISK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RiskStatus, to: RiskStatus, reason?: string | null): void {
  if (!canTransition(from, to)) {
    throw new RiskTransitionError(`A ${from} risk acceptance cannot move to ${to}`);
  }
  if (REASON_REQUIRED.includes(to) && !reason?.trim()) {
    throw new RiskTransitionError(`A reason is required to move to ${to}`);
  }
}

export function isExpiredNow(status: RiskStatus, expiryAt: string | Date, now: Date): boolean {
  return status === 'accepted' && new Date(expiryAt).getTime() <= now.getTime();
}

export const isSelfApproval = (actorId: string, requesterId: string) => actorId === requesterId;

/** An acceptance needing review no longer covers anything until a new decision is made. */
export function isEffective(a: { status: string; review_required: boolean }): boolean {
  return a.status === 'accepted' && !a.review_required;
}

export type RiskBucket = 'active' | 'pending' | 'expiring' | 'expired' | 'review_required';

export const EXPIRING_WINDOW_DAYS = 30;

export function riskBuckets(a: { status: string; review_required: boolean; expiry_at: string | Date }, now: Date): RiskBucket[] {
  const buckets: RiskBucket[] = [];
  if (a.status === 'pending') buckets.push('pending');
  if (a.status === 'expired') buckets.push('expired');
  if (a.status === 'accepted') {
    if (a.review_required) buckets.push('review_required');
    else buckets.push('active');
    const daysLeft = (new Date(a.expiry_at).getTime() - now.getTime()) / 86_400_000;
    if (daysLeft <= EXPIRING_WINDOW_DAYS) buckets.push('expiring');
  }
  return buckets;
}
