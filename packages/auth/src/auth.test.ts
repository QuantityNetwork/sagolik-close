import { describe, expect, it } from "vitest";
import {
  type Actor,
  type TransactionAccessContext,
  assertStepUp,
  can,
  canViewDocument,
  generateRecoveryCodes,
  hashRecoveryCode,
  permissionsFor,
  STEP_UP_MAX_AGE_MS,
  totpCode,
  verifyTotp,
} from "./index";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";

const actor = (userId: string, extra: Partial<Actor> = {}): Actor => ({
  userId,
  email: `${userId}@example.test`,
  displayName: userId,
  isPlatformAdmin: false,
  memberships: [],
  stepUpAt: null,
  sessionId: "s",
  ipAddress: null,
  userAgent: null,
  ...extra,
});

const ctx: TransactionAccessContext = {
  transactionId: "t1",
  organizationId: ORG,
  participants: [
    { id: "p1", userId: "buyer", role: "buyer", status: "active" },
    { id: "p2", userId: "agent", role: "buyer_agent", status: "active" },
    { id: "p3", userId: "escrow", role: "escrow_officer", status: "active" },
    { id: "p4", userId: "gone", role: "seller", status: "removed" },
    { id: "p5", userId: "notary", role: "notary", status: "active" },
  ],
};

describe("RBAC", () => {
  it("grants participants their role permissions only", () => {
    expect(can(actor("buyer"), "signature.sign", ctx)).toBe(true);
    expect(can(actor("buyer"), "payment.approve", ctx)).toBe(false);
    expect(can(actor("escrow"), "payment.approve", ctx)).toBe(true);
    expect(can(actor("agent"), "financial.view", ctx)).toBe(false);
  });

  it("denies outsiders and removed participants (IDOR)", () => {
    expect(permissionsFor(actor("stranger"), ctx).size).toBe(0);
    expect(can(actor("gone"), "transaction.view", ctx)).toBe(false);
  });

  it("gives platform admins no implicit transaction access", () => {
    expect(can(actor("root", { isPlatformAdmin: true }), "transaction.view", ctx)).toBe(false);
  });

  it("applies org grants only to the org's own transactions (tenant isolation)", () => {
    const admin = actor("admin", { memberships: [{ organizationId: ORG, role: "organization_admin" }] });
    const foreign = actor("foreign", { memberships: [{ organizationId: OTHER_ORG, role: "organization_admin" }] });
    expect(can(admin, "transaction.view", ctx)).toBe(true);
    expect(can(foreign, "transaction.view", ctx)).toBe(false);
  });

  it("enforces document access levels", () => {
    const restricted = { accessLevel: "restricted" as const, uploadedBy: "someone" };
    expect(canViewDocument(actor("buyer"), ctx, restricted)).toBe(false);
    expect(canViewDocument(actor("escrow"), ctx, restricted)).toBe(true);
    expect(canViewDocument(actor("buyer"), ctx, { accessLevel: "restricted", uploadedBy: "buyer" })).toBe(true);
    expect(canViewDocument(actor("buyer"), ctx, { accessLevel: "professionals_only", uploadedBy: null })).toBe(false);
    expect(canViewDocument(actor("notary"), ctx, { accessLevel: "principals_and_professionals", uploadedBy: null })).toBe(false);
    expect(canViewDocument(actor("stranger"), ctx, { accessLevel: "all_participants", uploadedBy: null })).toBe(false);
  });
});

describe("step-up", () => {
  it("requires a fresh step-up", () => {
    const now = 1_000_000_000;
    expect(() => assertStepUp(actor("a"), "payment.approve", now)).toThrow(/confirm/);
    expect(() => assertStepUp(actor("a", { stepUpAt: now - STEP_UP_MAX_AGE_MS - 1 }), "payment.approve", now)).toThrow();
    expect(() => assertStepUp(actor("a", { stepUpAt: now - 1000 }), "payment.approve", now)).not.toThrow();
    // A step-up timestamp from the future is not trusted.
    expect(() => assertStepUp(actor("a", { stepUpAt: now + 60_000 }), "payment.approve", now)).toThrow();
  });
});

describe("TOTP", () => {
  it("matches RFC 6238 test vector (SHA1, T=59)", () => {
    // Secret "12345678901234567890" in base32
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCode(secret, 59_000, 30, 8)).toBe("94287082");
  });
  it("verifies within drift and rejects garbage", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const t = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, t), t + 29_000)).toBe(true);
    expect(verifyTotp(secret, "12345", t)).toBe(false);
    expect(verifyTotp(secret, "abcdef", t)).toBe(false);
  });
  it("hashes recovery codes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0]!.toUpperCase())).toBe(hashes[0]);
  });
});
