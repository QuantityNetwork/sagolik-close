import type { Db } from "@sagolik/database";
import type { OrganizationRole } from "@sagolik/types";

/** Organization types that own properties (Property Autopilot), as opposed to professional firms. */
export const OWNER_ORGANIZATION_TYPES = ["personal_portfolio", "holding_entity", "family_office", "property_manager"] as const;
export const isOwnerOrganizationType = (type: string) => (OWNER_ORGANIZATION_TYPES as readonly string[]).includes(type);

/**
 * The person's memberships in professional firms (agencies, title, lenders…).
 * These grant access to the firm's transactions and the command center, so
 * owner portfolios are deliberately excluded: owning property through an LLC
 * or family office never makes someone a closing professional.
 */
export async function professionalMemberships(db: Db, userId: string): Promise<Array<{ organizationId: string; role: OrganizationRole }>> {
  const memberships = await db.organization_members.find({ userId });
  if (!memberships.length) return [];
  const orgs = await db.organizations.find({ id: memberships.map((m) => m.organizationId) });
  const owner = new Set(orgs.filter((o) => isOwnerOrganizationType(o.type)).map((o) => o.id));
  return memberships.filter((m) => !owner.has(m.organizationId)).map((m) => ({ organizationId: m.organizationId, role: m.role }));
}
