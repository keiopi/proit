import crypto from 'node:crypto';
import type { Db } from '../db/db';
import { assertInScope, getRiskAuthority, writeAudit, type Scope, type SessionUser } from '../auth';
import { assertTransition, isSelfApproval, RiskTransitionError, type RiskStatus } from '../../domain/riskStateMachine';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { getEntity } from './records';
import { notify } from './notifications';

type Row = Record<string, any>;

/** Moves accepted requests past their expiry date to Expired. Runs on relevant reads and writes. */
export async function applyRiskExpiry(db: Db, customerIds?: readonly string[], now = new Date()): Promise<void> {
  const due = await db.query<Row>(
    `SELECT id, customer_id FROM risk_acceptances WHERE status = 'accepted' AND expiry_at <= $1
     ${customerIds ? 'AND customer_id = ANY($2::text[])' : ''}`,
    customerIds ? [now, [...customerIds]] : [now],
  );
  for (const row of due) {
    await db.query(`UPDATE risk_acceptances SET status = 'expired', updated_at = $2 WHERE id = $1 AND status = 'accepted'`, [row.id, now]);
    await writeAudit(db, { id: 'system', name: 'System', role: 'admin' }, row.customer_id, 'risk_acceptance', row.id, 'expired', { from: 'accepted', to: 'expired' });
  }
}

export async function approverOptions(db: Db, scope: Scope, customerId: string): Promise<Row[]> {
  assertInScope(scope, customerId);
  return db.query(
    `SELECT u.id, u.name, u.title, r.kind FROM risk_approvers r JOIN users u ON u.id = r.user_id
     WHERE r.customer_id = $1 ORDER BY r.kind DESC, u.name`,
    [customerId],
  );
}

async function assertDesignatedApprover(db: Db, userId: string, customerId: string, label: string) {
  if (!(await getRiskAuthority(db, userId, customerId))) {
    throw badRequest(`${label} must hold risk approval authority for this customer`);
  }
}

export interface RiskInput {
  controlResultId: string;
  objectIds?: string[];
  justification: string;
  residualRisk: string;
  compensatingControls: string;
  riskOwnerId: string;
  approverId: string;
  expiryAt: string;
  reviewAt: string;
}

function validateDates(expiryAt: string, reviewAt: string, now: Date) {
  const expiry = new Date(expiryAt);
  const review = new Date(reviewAt);
  if (Number.isNaN(expiry.getTime()) || Number.isNaN(review.getTime())) throw badRequest('Expiry and review dates must be valid dates');
  if (expiry <= now) throw badRequest('The expiry date must be in the future');
  if (review <= now) throw badRequest('The review date must be in the future');
  if (review > expiry) throw badRequest('The review date must not be after the expiry date');
  return { expiry, review };
}

export async function createRisk(db: Db, scope: Scope, user: SessionUser, input: RiskInput, now = new Date()): Promise<Row> {
  const result = await getEntity(db, scope, 'hardening', input.controlResultId, now);
  if (result.result !== 'failed' && result.result !== 'warning') {
    throw badRequest('A risk acceptance can only be requested for a Failed or Warning control');
  }
  const { expiry, review } = validateDates(input.expiryAt, input.reviewAt, now);
  await assertDesignatedApprover(db, input.riskOwnerId, result.customer_id, 'The risk owner');
  await assertDesignatedApprover(db, input.approverId, result.customer_id, 'The approver');

  const objectIds = [...new Set([result.object_id, ...(input.objectIds ?? [])])];
  const objects = await db.query<Row>('SELECT id FROM objects WHERE id = ANY($1::text[]) AND customer_id = $2', [objectIds, result.customer_id]);
  if (objects.length !== objectIds.length) throw badRequest('Every affected object must belong to the same customer');

  const id = `RA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO risk_acceptances (id, customer_id, control_id, baseline_id, control_version, title, evidence, justification, severity, residual_risk,
        compensating_controls, risk_owner_id, approver_id, requester_id, status, expiry_at, review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$17,$17)`,
      [id, result.customer_id, result.control_id, result.baseline_id, result.control_version, `${result.control_code}: ${result.title}`, result.evidence,
        input.justification, result.severity, input.residualRisk, input.compensatingControls, input.riskOwnerId, input.approverId, user.id, expiry, review, now],
    );
    for (const objectId of objectIds) {
      await tx.query('INSERT INTO risk_acceptance_objects (acceptance_id, object_id) VALUES ($1, $2)', [id, objectId]);
    }
    await writeAudit(tx, user, result.customer_id, 'risk_acceptance', id, 'created', { status: 'draft', objects: objectIds, control_version: result.control_version });
  });
  return getEntity(db, scope, 'risk', id, now);
}

export type RiskPatch = Partial<Pick<RiskInput, 'justification' | 'residualRisk' | 'compensatingControls' | 'riskOwnerId' | 'approverId' | 'expiryAt' | 'reviewAt'>>;

export async function updateDraft(db: Db, scope: Scope, user: SessionUser, id: string, patch: RiskPatch, now = new Date()): Promise<Row> {
  const risk = await getEntity(db, scope, 'risk', id, now);
  if (risk.status !== 'draft') throw conflict('Only a draft can be edited');
  if (patch.riskOwnerId) await assertDesignatedApprover(db, patch.riskOwnerId, risk.customer_id, 'The risk owner');
  if (patch.approverId) await assertDesignatedApprover(db, patch.approverId, risk.customer_id, 'The approver');
  const expiryAt = patch.expiryAt ?? new Date(risk.expiry_at).toISOString();
  const reviewAt = patch.reviewAt ?? new Date(risk.review_at).toISOString();
  const { expiry, review } = validateDates(expiryAt, reviewAt, now);
  const next = {
    justification: patch.justification ?? risk.justification,
    residual_risk: patch.residualRisk ?? risk.residual_risk,
    compensating_controls: patch.compensatingControls ?? risk.compensating_controls,
    risk_owner_id: patch.riskOwnerId ?? risk.risk_owner_id,
    approver_id: patch.approverId ?? risk.approver_id,
  };
  await db.tx(async (tx) => {
    await tx.query(
      `UPDATE risk_acceptances SET justification=$2, residual_risk=$3, compensating_controls=$4, risk_owner_id=$5, approver_id=$6, expiry_at=$7, review_at=$8, updated_at=$9 WHERE id=$1`,
      [id, next.justification, next.residual_risk, next.compensating_controls, next.risk_owner_id, next.approver_id, expiry, review, now],
    );
    await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, 'edited', { changed: Object.keys(patch) });
  });
  return getEntity(db, scope, 'risk', id, now);
}

async function transition(db: Db, scope: Scope, id: string, to: RiskStatus, reason: string | null | undefined, now: Date): Promise<Row> {
  await applyRiskExpiry(db, scope.customerIds, now);
  const risk = await getEntity(db, scope, 'risk', id, now);
  try {
    assertTransition(risk.status, to, reason);
  } catch (err) {
    if (err instanceof RiskTransitionError) throw conflict(err.message);
    throw err;
  }
  return risk;
}

export async function submitRisk(db: Db, scope: Scope, user: SessionUser, id: string, now = new Date()): Promise<Row> {
  const risk = await transition(db, scope, id, 'pending', null, now);
  if (!risk.justification?.trim() || !risk.compensating_controls?.trim() || !risk.residual_risk?.trim()) {
    throw badRequest('Justification, residual risk and compensating controls are required before submitting');
  }
  validateDates(new Date(risk.expiry_at).toISOString(), new Date(risk.review_at).toISOString(), now);
  await db.tx(async (tx) => {
    await tx.query(`UPDATE risk_acceptances SET status='pending', updated_at=$2 WHERE id=$1`, [id, now]);
    await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, 'submitted', { from: 'draft', to: 'pending' });
    await notify(tx, [risk.approver_id, risk.risk_owner_id], risk.customer_id, 'risk_pending', `Approval needed: ${risk.id}`, `${risk.title} is waiting for your decision.`, `/risk-acceptances?record=${risk.id}`, `risk-pending:${risk.id}`);
  });
  return getEntity(db, scope, 'risk', id, now);
}

/** Authority comes from risk_approvers and the record's designation. Role plays no part. */
async function assertDecisionAuthority(db: Db, user: SessionUser, risk: Row) {
  const authority = await getRiskAuthority(db, user.id, risk.customer_id);
  const designated = user.id === risk.approver_id || user.id === risk.risk_owner_id;
  if (!authority || (!designated && authority !== 'delegate')) {
    throw forbidden('Only the designated customer risk owner or an authorized delegate can decide on this request');
  }
  return authority;
}

export async function approveRisk(db: Db, scope: Scope, user: SessionUser, id: string, confirmSelfApproval: boolean, now = new Date()): Promise<Row> {
  const risk = await transition(db, scope, id, 'accepted', null, now);
  const authority = await assertDecisionAuthority(db, user, risk);
  const self = isSelfApproval(user.id, risk.requester_id);
  if (self && !confirmSelfApproval) {
    throw conflict('You submitted this request. Confirm self-approval to continue');
  }
  if (new Date(risk.expiry_at) <= now) throw conflict('The requested expiry date has passed. Renew or create a new request');
  await db.tx(async (tx) => {
    await tx.query(
      `UPDATE risk_acceptances SET status='accepted', decision_at=$2, decision_by=$3, self_approved=$4, updated_at=$2 WHERE id=$1`,
      [id, now, user.id, self],
    );
    await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, self ? 'self_approved' : 'approved', { from: 'pending', to: 'accepted', authority, self_approved: self });
    await notify(tx, [risk.requester_id], risk.customer_id, 'risk_decision', `Accepted: ${risk.id}`, `${risk.title} was accepted by ${user.name}.`, `/risk-acceptances?record=${risk.id}`, `risk-decision:${risk.id}:accepted`);
  });
  return getEntity(db, scope, 'risk', id, now);
}

export async function rejectRisk(db: Db, scope: Scope, user: SessionUser, id: string, reason: string, now = new Date()): Promise<Row> {
  const risk = await transition(db, scope, id, 'rejected', reason, now);
  const authority = await assertDecisionAuthority(db, user, risk);
  await db.tx(async (tx) => {
    await tx.query(`UPDATE risk_acceptances SET status='rejected', decision_at=$2, decision_by=$3, decision_reason=$4, updated_at=$2 WHERE id=$1`, [id, now, user.id, reason]);
    await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, 'rejected', { from: 'pending', to: 'rejected', reason, authority });
    await notify(tx, [risk.requester_id], risk.customer_id, 'risk_decision', `Rejected: ${risk.id}`, `${risk.title} was rejected: ${reason}`, `/risk-acceptances?record=${risk.id}`, `risk-decision:${risk.id}:rejected`);
  });
  return getEntity(db, scope, 'risk', id, now);
}

export async function revokeRisk(db: Db, scope: Scope, user: SessionUser, id: string, reason: string, now = new Date()): Promise<Row> {
  const risk = await transition(db, scope, id, 'revoked', reason, now);
  const authority = await assertDecisionAuthority(db, user, risk);
  await db.tx(async (tx) => {
    await tx.query(`UPDATE risk_acceptances SET status='revoked', decision_reason=$2, updated_at=$3 WHERE id=$1`, [id, reason, now]);
    await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, 'revoked', { from: 'accepted', to: 'revoked', reason, authority });
    await notify(tx, [risk.requester_id, risk.risk_owner_id], risk.customer_id, 'risk_decision', `Revoked: ${risk.id}`, `${risk.title} was revoked: ${reason}`, `/risk-acceptances?record=${risk.id}`, `risk-decision:${risk.id}:revoked`);
  });
  return getEntity(db, scope, 'risk', id, now);
}

/** Creates a linked draft. The previous request and its decision stay exactly as they were. */
export async function renewRisk(db: Db, scope: Scope, user: SessionUser, id: string, now = new Date()): Promise<Row> {
  await applyRiskExpiry(db, scope.customerIds, now);
  const risk = await getEntity(db, scope, 'risk', id, now);
  if (risk.status !== 'accepted' && risk.status !== 'expired') throw conflict('Only an accepted or expired request can be renewed');
  const control = await db.query<Row>('SELECT version FROM controls WHERE id = $1', [risk.control_id]);
  const newId = `RA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const expiry = new Date(now.getTime() + 180 * 86_400_000);
  const review = new Date(now.getTime() + 90 * 86_400_000);
  await db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO risk_acceptances (id, customer_id, control_id, baseline_id, control_version, title, evidence, justification, severity, residual_risk,
        compensating_controls, risk_owner_id, approver_id, requester_id, status, expiry_at, review_at, renewed_from_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$17,$18,$18)`,
      [newId, risk.customer_id, risk.control_id, risk.baseline_id, control[0].version, risk.title, risk.evidence, risk.justification, risk.severity, risk.residual_risk,
        risk.compensating_controls, risk.risk_owner_id, risk.approver_id, user.id, expiry, review, id, now],
    );
    for (const o of risk.affected_objects) {
      await tx.query('INSERT INTO risk_acceptance_objects (acceptance_id, object_id) VALUES ($1, $2)', [newId, o.id]);
    }
    await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', newId, 'created_as_renewal', { renewed_from: id });
    await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, 'renewal_started', { renewal: newId });
  });
  return getEntity(db, scope, 'risk', newId, now);
}

/**
 * Changes the affected objects. On a draft this is an edit. After a decision, new
 * objects stay outside the approved scope and the request is flagged for review.
 */
export async function changeRiskScope(db: Db, scope: Scope, user: SessionUser, id: string, objectIds: string[], now = new Date()): Promise<Row> {
  const risk = await getEntity(db, scope, 'risk', id, now);
  if (risk.status !== 'draft' && risk.status !== 'accepted') throw conflict('The affected scope can only change on a draft or an accepted request');
  const unique = [...new Set(objectIds)];
  if (unique.length === 0) throw badRequest('Choose at least one affected object');
  const valid = await db.query<Row>('SELECT id FROM objects WHERE id = ANY($1::text[]) AND customer_id = $2', [unique, risk.customer_id]);
  if (valid.length !== unique.length) throw badRequest('Every affected object must belong to the same customer');
  const before: string[] = risk.affected_objects.map((o: Row) => o.id);
  const added = unique.filter((o) => !before.includes(o));
  const removed = before.filter((o) => !unique.includes(o));
  if (added.length === 0 && removed.length === 0) return risk;

  await db.tx(async (tx) => {
    for (const objectId of removed) await tx.query('DELETE FROM risk_acceptance_objects WHERE acceptance_id = $1 AND object_id = $2', [id, objectId]);
    const approved = risk.status === 'draft';
    for (const objectId of added) await tx.query('INSERT INTO risk_acceptance_objects (acceptance_id, object_id, approved_scope) VALUES ($1, $2, $3)', [id, objectId, approved]);
    if (risk.status === 'accepted') {
      const reviewReason = `Affected scope changed after the decision (added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}).`;
      await tx.query('UPDATE risk_acceptances SET review_required = true, review_reason = $2, updated_at = $3 WHERE id = $1', [id, reviewReason, now]);
      await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, 'review_required', { reason: reviewReason, added, removed });
      await notify(tx, [risk.risk_owner_id, risk.approver_id], risk.customer_id, 'risk_review', `Review required: ${risk.id}`, reviewReason, `/risk-acceptances?record=${risk.id}`, `risk-review-scope:${risk.id}:${now.getTime()}`);
    } else {
      await tx.query('UPDATE risk_acceptances SET updated_at = $2 WHERE id = $1', [id, now]);
      await writeAudit(tx, user, risk.customer_id, 'risk_acceptance', id, 'edited', { added, removed });
    }
  });
  return getEntity(db, scope, 'risk', id, now);
}

/** Admin demo action. Publishes a new control version and flags every acceptance built on the old one. */
export async function publishControlVersion(db: Db, scope: Scope, user: SessionUser, controlId: string, now = new Date()): Promise<{ version: string; flagged: string[] }> {
  if (user.role !== 'admin') throw forbidden('Only a System Administrator can run this simulation');
  const rows = await db.query<Row>('SELECT * FROM controls WHERE id = $1', [controlId]);
  if (!rows[0]) throw notFound('Control');
  const inScope = await db.query<Row>('SELECT 1 FROM control_results WHERE control_id = $1 AND customer_id = ANY($2::text[]) LIMIT 1', [controlId, [...scope.customerIds]]);
  if (!inScope[0]) throw notFound('Control');
  const parts = String(rows[0].version).split('.');
  const version = `${parts[0]}.${Number(parts[1] ?? 0) + 1}`;
  const flagged: string[] = [];
  await db.tx(async (tx) => {
    await tx.query('UPDATE controls SET version = $2 WHERE id = $1', [controlId, version]);
    const affected = await tx.query<Row>(`SELECT * FROM risk_acceptances WHERE control_id = $1 AND status = 'accepted' AND customer_id = ANY($2::text[])`, [controlId, [...scope.customerIds]]);
    for (const a of affected) {
      const reason = `Control version changed from ${a.control_version} to ${version} after the decision.`;
      await tx.query('UPDATE risk_acceptances SET review_required = true, review_reason = $2, updated_at = $3 WHERE id = $1', [a.id, reason, now]);
      await writeAudit(tx, user, a.customer_id, 'risk_acceptance', a.id, 'review_required', { reason });
      await notify(tx, [a.risk_owner_id, a.approver_id], a.customer_id, 'risk_review', `Review required: ${a.id}`, reason, `/risk-acceptances?record=${a.id}`, `risk-review-version:${a.id}:${version}`);
      flagged.push(a.id);
    }
  });
  return { version, flagged };
}
