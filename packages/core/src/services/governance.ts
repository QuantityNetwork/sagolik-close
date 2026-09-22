/**
 * Audit access, audit packages, privacy center and the internal admin.
 */
import { assertStepUp } from "@sagolik/auth";
import { FEATURE_FLAGS, type FeatureFlagKey } from "@sagolik/config";
import { sha256Hex } from "@sagolik/security";
import { type ServiceContext, requireUser } from "../context";
import { badRequest, forbidden } from "../errors";
import { audit } from "../events";
import { loadAuthorized } from "../snapshot";
import { newId, nowIso } from "../util";

// ----------------------------------------------------------------------------- audit trail

export async function listAudit(ctx: ServiceContext, transactionId: string, opts: { action?: string; limit?: number } = {}) {
  const s = await loadAuthorized(ctx, transactionId, "audit.view");
  const events = await ctx.db.audit_events.find({ transactionId, ...(opts.action ? { action: opts.action } : {}) }, { orderBy: "occurredAt", ascending: false, limit: opts.limit ?? 200 });
  const transitions = await ctx.db.transaction_events.find({ transactionId }, { orderBy: "occurredAt", ascending: false, limit: 100 });
  const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
  const profiles = actorIds.length ? await ctx.db.profiles.find({ id: actorIds }) : [];
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.fullName]));
  return { snapshot: s, events, transitions, names };
}

/** Complete, hash-sealed record of a transaction for auditors/regulators. Step-up required. */
export async function exportAuditPackage(ctx: ServiceContext, transactionId: string) {
  const actor = requireUser(ctx);
  const s = await loadAuthorized(ctx, transactionId, "audit.export");
  assertStepUp(actor, "audit.export_full", ctx.now().getTime());
  const [events, transitions, versions, paymentEvents, webhooks] = await Promise.all([
    ctx.writer.audit_events.find({ transactionId }, { orderBy: "occurredAt" }),
    ctx.writer.transaction_events.find({ transactionId }, { orderBy: "occurredAt" }),
    ctx.writer.document_versions.find({ transactionId }, { orderBy: "createdAt" }),
    ctx.writer.payment_events.find({ transactionId }, { orderBy: "occurredAt" }),
    ctx.writer.webhook_events.find({}, { orderBy: "receivedAt" }),
  ]);
  const body = {
    format: "sagolik-close/audit-package@1",
    generatedAt: nowIso(ctx),
    generatedBy: { userId: actor.userId, name: actor.displayName },
    transaction: s.transaction,
    property: s.property,
    participants: s.participants.map((p) => ({ id: p.id, role: p.role, displayName: p.displayName, status: p.status, joinedAt: p.joinedAt })),
    stateTransitions: transitions,
    auditEvents: events,
    documents: s.documents.map((d) => ({ ...d, versions: versions.filter((v) => v.documentId === d.id).map((v) => ({ version: v.version, sha256: v.sha256, sizeBytes: v.sizeBytes, isSigned: v.isSigned, createdAt: v.createdAt, uploadedBy: v.uploadedBy })) })),
    signatures: s.signatures,
    identity: s.identityVerifications.map((v) => ({ participantId: v.participantId, provider: v.provider, status: v.status, checks: v.checks, verifiedAt: v.verifiedAt })),
    compliance: s.complianceCases,
    payments: s.payments,
    paymentEvents,
    bankInstructions: s.bankInstructions.map(({ encryptedAccountNumber: _omit, ...rest }) => rest),
    escrow: s.escrow,
    escrowConditions: s.escrowConditions,
    mortgage: s.mortgage,
    mortgageConditions: s.mortgageConditions,
    title: s.titleCase,
    titleIssues: s.titleIssues,
    recording: s.recording,
    providerEvents: webhooks
      .filter((w) => JSON.stringify(w.payload).includes(transactionId) || s.payments.some((p) => p.externalPaymentId && JSON.stringify(w.payload).includes(p.externalPaymentId)))
      .map(({ payload: _p, ...rest }) => rest),
  };
  const json = JSON.stringify(body, null, 2);
  const seal = sha256Hex(json);
  await audit(ctx, { action: "audit.exported", resourceType: "transaction", resourceId: transactionId, transactionId, organizationId: s.transaction.organizationId, metadata: { sha256: seal, events: events.length } });
  return { filename: `${s.transaction.reference}-audit-package.json`, json, sha256: seal };
}

// ----------------------------------------------------------------------------- privacy center

export async function exportMyData(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  const uid = actor.userId;
  const [profile, participations, notifications, prefs, consents, connections, accounts, verifications, messages, auditTrail, ownership] = await Promise.all([
    ctx.writer.profiles.get(uid),
    ctx.writer.transaction_participants.find({ userId: uid }),
    ctx.writer.notifications.find({ userId: uid }),
    ctx.writer.notification_preferences.find({ userId: uid }),
    ctx.writer.consent_records.find({ userId: uid }),
    ctx.writer.bank_connections.find({ userId: uid }),
    ctx.writer.bank_accounts.find({ userId: uid }),
    ctx.writer.identity_verifications.find({ userId: uid }),
    ctx.writer.messages.find({ authorId: uid }),
    ctx.writer.audit_events.find({ actorId: uid }, { orderBy: "occurredAt" }),
    ctx.writer.ownership_records.find({}),
  ]);
  const data = {
    format: "sagolik-close/personal-data@1",
    generatedAt: nowIso(ctx),
    profile,
    transactions: participations.map((p) => ({ transactionId: p.transactionId, role: p.role, status: p.status, joinedAt: p.joinedAt })),
    notifications,
    notificationPreferences: prefs,
    consents,
    bankConnections: connections,
    bankAccounts: accounts.map((a) => ({ ...a, externalAccountId: "[provider reference withheld]" })),
    identityVerifications: verifications.map((v) => ({ provider: v.provider, status: v.status, checks: v.checks, verifiedAt: v.verifiedAt })),
    messages,
    activity: auditTrail,
    homeRecords: ownership.filter((o) => o.ownerUserIds.includes(uid)),
    notes: [
      "Raw identity documents are held by the identity provider, not by Sagolik Close.",
      "Some records must be retained for legal and regulatory reasons even after an erasure request (see the privacy policy).",
    ],
  };
  await audit(ctx, { action: "user.data_exported", resourceType: "profile", resourceId: uid });
  return data;
}

export async function recordConsent(ctx: ServiceContext, purpose: string, granted: boolean, policyVersion: string) {
  const actor = requireUser(ctx);
  if (!/^[a-z_]{3,40}$/.test(purpose)) throw badRequest("Unknown consent purpose.");
  return ctx.writer.consent_records.insert({ id: newId(), userId: actor.userId, purpose, granted, policyVersion, createdAt: nowIso(ctx) });
}

// ----------------------------------------------------------------------------- internal admin (platform admins, audited)

function requireAdmin(ctx: ServiceContext) {
  const actor = requireUser(ctx);
  if (!actor.isPlatformAdmin) throw forbidden();
  return actor;
}

/** Aggregate operational view. Never exposes document contents, balances or account numbers. */
export async function adminOverview(ctx: ServiceContext) {
  requireAdmin(ctx);
  const w = ctx.writer;
  const [orgs, profiles, txs, failedWebhooks, deadEvents, signals, flags, recentAudit] = await Promise.all([
    w.organizations.find({}, { orderBy: "createdAt" }),
    w.profiles.find({}, { orderBy: "createdAt" }),
    w.transactions.find({}),
    w.webhook_events.find({ status: ["failed", "dead_letter"] }, { orderBy: "receivedAt", ascending: false, limit: 50 }),
    w.domain_events.find({ status: ["failed", "dead_letter"] }, { orderBy: "createdAt", ascending: false, limit: 50 }),
    w.security_signals.find({ resolved: false }, { orderBy: "createdAt", ascending: false, limit: 50 }),
    w.feature_flags.find({}),
    w.audit_events.find({}, { orderBy: "occurredAt", ascending: false, limit: 50 }),
  ]);
  await audit(ctx, { action: "admin.privileged_access", resourceType: "admin_console", metadata: { view: "overview" } });
  const byState: Record<string, number> = {};
  for (const t of txs) byState[t.state] = (byState[t.state] ?? 0) + 1;
  const p = ctx.providers;
  return {
    organizations: orgs.map((o) => ({ ...o, transactions: txs.filter((t) => t.organizationId === o.id).length })),
    users: profiles.map((u) => ({ id: u.id, fullName: u.fullName, email: u.email, isPlatformAdmin: u.isPlatformAdmin, createdAt: u.createdAt })),
    transactionsByState: byState,
    totalTransactions: txs.length,
    failedWebhooks,
    deadEvents,
    securitySignals: signals,
    flags: (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map((key) => {
      const row = flags.find((f) => f.key === key);
      return { key, description: FEATURE_FLAGS[key].description, enabled: row ? row.enabled : FEATURE_FLAGS[key].default, rolloutPercent: row?.rolloutPercent ?? (FEATURE_FLAGS[key].default ? 100 : 0), overridden: !!row };
    }),
    integrations: [p.banking, p.identity, p.signatures, p.payments, p.escrow, p.property, p.mortgage, p.title, p.insurance, p.email, p.sms].map((x) => x.info),
    recentAudit,
  };
}

export async function adminSearchAudit(ctx: ServiceContext, q: { action?: string; actorId?: string; transactionId?: string; limit?: number }) {
  requireAdmin(ctx);
  await audit(ctx, { action: "admin.privileged_access", resourceType: "audit_events", metadata: { view: "audit_search", filters: q } });
  return ctx.writer.audit_events.find(
    { ...(q.action ? { action: q.action } : {}), ...(q.actorId ? { actorId: q.actorId } : {}), ...(q.transactionId ? { transactionId: q.transactionId } : {}) },
    { orderBy: "occurredAt", ascending: false, limit: q.limit ?? 100 },
  );
}

export async function adminSetFlag(ctx: ServiceContext, key: FeatureFlagKey, enabled: boolean, rolloutPercent = 100) {
  const actor = requireAdmin(ctx);
  assertStepUp(actor, "organization.role_change", ctx.now().getTime());
  if (!(key in FEATURE_FLAGS)) throw badRequest("Unknown flag.");
  const existing = await ctx.writer.feature_flags.findOne({ key });
  const now = nowIso(ctx);
  if (existing) await ctx.writer.feature_flags.update(existing.id, { enabled, rolloutPercent });
  else await ctx.writer.feature_flags.insert({ id: newId(), key, description: FEATURE_FLAGS[key].description, enabled, rolloutPercent, organizationIds: [], createdAt: now, updatedAt: now });
  await audit(ctx, { action: "admin.feature_flag_changed", resourceType: "feature_flag", resourceId: key, metadata: { enabled, rolloutPercent, previous: existing ? { enabled: existing.enabled, rolloutPercent: existing.rolloutPercent } : null } });
}

export async function adminRetryWebhook(ctx: ServiceContext, webhookEventId: string) {
  requireAdmin(ctx);
  const row = await ctx.writer.webhook_events.get(webhookEventId);
  if (!row || (row.status !== "dead_letter" && row.status !== "failed")) throw badRequest("Only failed events can be retried.");
  await ctx.writer.webhook_events.update(row.id, { status: "failed", attempts: 0 });
  await audit(ctx, { action: "admin.privileged_access", resourceType: "webhook_event", resourceId: row.id, metadata: { action: "requeue" } });
}
