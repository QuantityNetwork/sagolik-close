import type {
  AccessLevel,
  OrganizationRole,
  ParticipantRole,
  ParticipantStatus,
  Permission,
} from "@sagolik/types";
import { ORGANIZATION_ROLE_PERMISSIONS, ROLE_PERMISSIONS, roleMeetsAccessLevel } from "./permissions";

/** Who is acting. Built server-side from the verified session — never from request bodies. */
export interface Actor {
  userId: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
  memberships: ReadonlyArray<{ organizationId: string; role: OrganizationRole }>;
  /** Epoch ms of the last successful step-up (MFA / re-auth), if any. */
  stepUpAt: number | null;
  sessionId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/** The slice of a transaction needed to decide access. */
export interface TransactionAccessContext {
  transactionId: string;
  organizationId: string;
  participants: ReadonlyArray<{ id: string; userId: string | null; role: ParticipantRole; status: ParticipantStatus }>;
}

export class AuthorizationError extends Error {
  readonly code = "forbidden" as const;
  constructor(
    readonly permission: Permission | string,
    message = "You don't have access to do that.",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function actorParticipations(actor: Actor, ctx: TransactionAccessContext) {
  return ctx.participants.filter((p) => p.userId === actor.userId && p.status !== "removed" && p.status !== "declined");
}

export function actorRoles(actor: Actor, ctx: TransactionAccessContext): ParticipantRole[] {
  return actorParticipations(actor, ctx).map((p) => p.role);
}

/** Effective permission set of an actor on one transaction. */
export function permissionsFor(actor: Actor, ctx: TransactionAccessContext): Set<Permission> {
  const perms = new Set<Permission>();
  for (const role of actorRoles(actor, ctx)) {
    for (const p of ROLE_PERMISSIONS[role]) perms.add(p);
  }
  for (const m of actor.memberships) {
    if (m.organizationId !== ctx.organizationId) continue;
    for (const p of ORGANIZATION_ROLE_PERMISSIONS[m.role]) perms.add(p);
  }
  // Platform admins get NO implicit transaction access. Support access goes
  // through explicit, audited privileged operations in the admin service.
  return perms;
}

export function can(actor: Actor, permission: Permission, ctx: TransactionAccessContext): boolean {
  return permissionsFor(actor, ctx).has(permission);
}

export function assertCan(actor: Actor, permission: Permission, ctx: TransactionAccessContext): void {
  if (!can(actor, permission, ctx)) throw new AuthorizationError(permission);
}

/**
 * Document visibility: transaction permission + the document's own access
 * classification. Uploaders can always see what they uploaded.
 */
export function canViewDocument(
  actor: Actor,
  ctx: TransactionAccessContext,
  doc: { accessLevel: AccessLevel; uploadedBy: string | null },
): boolean {
  const perms = permissionsFor(actor, ctx);
  if (!perms.has("document.view")) return false;
  if (doc.uploadedBy === actor.userId) return true;
  if (doc.accessLevel === "restricted") return perms.has("document.view_restricted");
  const roles = actorRoles(actor, ctx);
  // Organization-level grants (admin/auditor) see everything except restricted.
  const orgGrant = actor.memberships.some(
    (m) => m.organizationId === ctx.organizationId && ORGANIZATION_ROLE_PERMISSIONS[m.role].includes("document.view"),
  );
  if (orgGrant) return true;
  return roles.some((r) => roleMeetsAccessLevel(r, doc.accessLevel));
}

export function isOrgAdmin(actor: Actor, organizationId: string): boolean {
  return actor.memberships.some((m) => m.organizationId === organizationId && m.role === "organization_admin");
}
