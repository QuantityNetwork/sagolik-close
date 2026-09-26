/**
 * Audit trail + domain events vocabulary.
 *
 * - Audit events answer "who did what, when, from where" and are append-only
 *   (enforced by a database trigger that rejects UPDATE/DELETE).
 * - Domain events are facts the rest of the system reacts to (notifications,
 *   workflow advancement, integrations). They go through the `domain_events`
 *   outbox so reactions are retried, idempotent and observable.
 */
export const AUDIT_ACTIONS = [
  "user.login",
  "user.logout",
  "user.step_up",
  "user.step_up_failed",
  "user.mfa_enrolled",
  "user.data_exported",
  "transaction.created",
  "transaction.updated",
  "transaction.state_changed",
  "participant.invited",
  "participant.removed",
  "task.created",
  "task.updated",
  "document.uploaded",
  "document.version_added",
  "document.viewed",
  "document.downloaded",
  "document.approved",
  "document.rejected",
  "document.field_verified",
  "document.quarantined",
  "signature.requested",
  "signature.completed",
  "signature.declined",
  "identity.started",
  "identity.completed",
  "compliance.case_opened",
  "compliance.decided",
  "source_of_funds.declared",
  "bank.connected",
  "bank.refreshed",
  "bank.funds_checked",
  "bank.disconnected",
  "bank_instruction.created",
  "bank_instruction.verified",
  "bank_instruction.revealed",
  "beneficiary.changed",
  "payment.initiated",
  "payment.approved",
  "payment.status_changed",
  "payment.settled",
  "escrow.opened",
  "escrow.condition_satisfied",
  "escrow.disbursed",
  "escrow.movement_recorded",
  "mortgage.status_changed",
  "mortgage.condition_satisfied",
  "title.status_changed",
  "title.issue_resolved",
  "recording.ready",
  "recording.submitted",
  "ownership.recorded",
  "ownership.record_created",
  "message.sent",
  "calendar.event_created",
  "webhook.rejected",
  "security.signal_raised",
  "audit.exported",
  "admin.privileged_access",
  "admin.feature_flag_changed",
  "assistant.query",
  "autopilot.prepared",
  "autopilot.property_imported",
  "autopilot.obligation_added",
  "autopilot.obligation_updated",
  "autopilot.bill_added",
  "autopilot.bill_paid_reported",
  "autopilot.bill_reviewed",
  "autopilot.bill_status_changed",
  "autopilot.bill_file_viewed",
  "autopilot.funding_updated",
  "autopilot.policy_updated",
  "autopilot.monitoring_changed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const DOMAIN_EVENT_TYPES = [
  "transaction.created",
  "transaction.state_changed",
  "participant.invited",
  "identity.verified",
  "identity.failed",
  "document.uploaded",
  "document.signed",
  "signature.requested",
  "bank.connected",
  "bank.reauth_required",
  "escrow.deposit_received",
  "payment.status_changed",
  "mortgage.clear_to_close",
  "title.cleared",
  "closing.ready",
  "recording.submitted",
  "ownership.transferred",
  "message.posted",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

/** Retry schedule for outbox processing (ms). After the last, the event is dead-lettered. */
export const OUTBOX_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;

export function nextAttemptDelay(attempts: number): number | null {
  return OUTBOX_BACKOFF_MS[attempts] ?? null;
}

export function newCorrelationId(): string {
  return `corr_${crypto.randomUUID().replace(/-/g, "")}`;
}
