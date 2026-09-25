import type { Document, Transaction, TransactionParticipant } from "@sagolik/types";
import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  capabilityEnabled,
  checkTransition,
  closingBlockers,
  dealSubject,
  evaluateAllFacts,
  evaluateRules,
  getJurisdiction,
  JURISDICTIONS,
  planAutomaticAdvance,
  progressPercent,
  recordingReadiness,
  TRANSITIONS,
  type TransactionSnapshot,
} from "./index";

const T0 = "2026-01-01T00:00:00.000Z";
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function participant(role: TransactionParticipant["role"]): TransactionParticipant {
  return { id: id(), transactionId: "t", userId: id(), organizationId: null, role, displayName: role, email: `${role}@x.test`, status: "active", invitedBy: null, joinedAt: T0, createdAt: T0, updatedAt: T0 };
}

function document(category: Document["category"], patch: Partial<Document> = {}): Document {
  return { id: id(), transactionId: "t", name: category, category, currentVersion: 1, status: "approved", signatureStatus: "not_required", accessLevel: "all_participants", retentionPolicy: "x", uploadedBy: null, expiresAt: null, createdAt: T0, updatedAt: T0, ...patch };
}

function snapshot(state: Transaction["state"], patch: Partial<TransactionSnapshot> = {}): TransactionSnapshot {
  const buyer = participant("buyer");
  const seller = participant("seller");
  return {
    transaction: { id: "t", organizationId: "o", propertyId: "p", companyId: null, reference: "R", type: "purchase", state, jurisdiction: "US-TX", currency: "USD", salePrice: 100, expectedClosingDate: "2026-02-01", coordinatorId: null, createdBy: "u", stateChangedAt: T0, closedAt: null, version: 1, createdAt: T0, updatedAt: T0 },
    property: { id: "p", organizationId: null, addressLine1: "1 A St", addressLine2: null, city: "Austin", region: "TX", postalCode: null, country: "US", latitude: null, longitude: null, parcelId: null, propertyType: "sf", yearBuilt: null, livingArea: null, areaUnit: "sqft", bedrooms: null, bathrooms: null, lotSize: null, imageUrls: [], propertyTaxAnnual: null, hoaMonthly: null, energyRating: null, legalDescription: null, currency: "USD", createdAt: T0, updatedAt: T0 },
    company: null,
    participants: [buyer, seller],
    milestones: [],
    tasks: [],
    taskDependencies: [],
    documents: [],
    signatures: [],
    identityVerifications: [],
    complianceCases: [],
    sourceOfFunds: [],
    payments: [],
    bankInstructions: [],
    escrow: null,
    escrowConditions: [],
    mortgage: null,
    mortgageConditions: [],
    titleCase: null,
    titleIssues: [],
    recording: null,
    ...patch,
  };
}

const verified = (s: TransactionSnapshot) =>
  s.participants.map((p) => ({ id: id(), transactionId: "t", participantId: p.id, userId: p.userId, provider: "m", externalId: id(), status: "verified" as const, checks: { document: "verified" as const, liveness: "verified" as const, address: "verified" as const, sanctions: "verified" as const, pep: "verified" as const }, verifiedAt: T0, expiresAt: null, failureReason: null, createdAt: T0, updatedAt: T0 }));

describe("state machine", () => {
  it("rejects undefined transitions", () => {
    const c = checkTransition(snapshot("draft"), "closed");
    expect(c.allowed).toBe(false);
  });

  it("guards identity → documents on verified identities", () => {
    const s = snapshot("identity_pending");
    expect(checkTransition(s, "documents_pending").allowed).toBe(false);
    expect(checkTransition(s, "documents_pending").unmet[0]!.fact).toBe("identity_verified");
    expect(checkTransition({ ...s, identityVerifications: verified(s) }, "documents_pending").allowed).toBe(true);
  });

  it("never allows ownership_transfer without a confirmed recording", () => {
    const s = snapshot("recording_pending", {
      recording: { id: "r", transactionId: "t", status: "recorded", registry: "County", recordingReference: null, submittedAt: T0, submittedBy: null, recordedAt: T0, confirmationSource: null, confirmedBy: null, documentId: null, createdAt: T0, updatedAt: T0 },
    });
    expect(checkTransition(s, "ownership_transfer").allowed).toBe(false);
    const confirmed = { ...s, recording: { ...s.recording!, recordingReference: "REF-1", confirmationSource: "authorized_professional" as const } };
    expect(checkTransition(confirmed, "ownership_transfer").allowed).toBe(true);
  });

  it("allows disputes from every active state and treats closed/cancelled as terminal", () => {
    expect(checkTransition(snapshot("signing"), "disputed").allowed).toBe(true);
    expect(checkTransition(snapshot("closed"), "disputed").allowed).toBe(false);
    expect(checkTransition(snapshot("cancelled"), "invited").allowed).toBe(false);
  });

  it("advances automatically only through automatic, satisfied transitions", () => {
    const base = snapshot("identity_pending");
    const s = { ...base, identityVerifications: verified(base), documents: [document("purchase_agreement", { signatureStatus: "completed" })] };
    // identity → documents → financing → conditions (no mortgage) then stops at the title guard.
    expect(planAutomaticAdvance(s)).toEqual(["documents_pending", "financing_pending", "conditions_pending"]);
    expect(planAutomaticAdvance(snapshot("draft"))).toEqual([]);
  });

  it("closing is a human sign-off, never automatic", () => {
    const def = TRANSITIONS.find((t) => t.from === "ownership_transfer" && t.to === "closed")!;
    expect(def.automatic).toBe(false);
    expect(def.permission).toBe("transaction.close");
  });
});

describe("rules", () => {
  it("explains which facts block the escrow deposit", () => {
    const s = snapshot("documents_pending");
    const r = evaluateRules(s).find((x) => x.rule.id === "escrow_deposit_enabled")!;
    expect(r.satisfied).toBe(false);
    expect(r.conditions.map((c) => [c.fact, c.value])).toEqual([
      ["identity_verified", false],
      ["purchase_agreement_signed", false],
    ]);
    expect(capabilityEnabled({ ...s, identityVerifications: verified(s), documents: [document("purchase_agreement", { signatureStatus: "completed" })] }, "escrow_deposit")).toBe(true);
  });

  it("lists recording requirements with responsible roles", () => {
    const { ready, items } = recordingReadiness(snapshot("signing"));
    expect(ready).toBe(false);
    expect(items.find((i) => i.fact === "title_clear")!.responsibleRole).toBe("title_officer");
    expect(closingBlockers(snapshot("signing")).length).toBeGreaterThan(0);
  });
});

describe("timeline", () => {
  it("marks exactly one current milestone and computes progress", () => {
    const base = snapshot("documents_pending");
    const s = { ...base, identityVerifications: verified(base), documents: [document("purchase_agreement", { signatureStatus: "completed" })] };
    const tl = buildTimeline(s, "2026-01-10");
    expect(tl.filter((m) => m.current)).toHaveLength(1);
    expect(tl.find((m) => m.key === "identity_verified")!.complete).toBe(true);
    expect(progressPercent(tl)).toBeGreaterThan(0);
  });

  it("flags blocked milestones from exceptions", () => {
    const s = snapshot("conditions_pending", {
      titleCase: { id: "tc", transactionId: "t", titleCompany: "T Co", status: "issues_found", currentOwner: null, searchCompletedAt: null, clearedAt: null, insurancePolicyNumber: null, provider: "m", externalReference: null, createdAt: T0, updatedAt: T0 },
      titleIssues: [{ id: "ti", titleCaseId: "tc", transactionId: "t", kind: "lien", description: "Contractor lien", amount: 1, resolved: false, resolvedAt: null, createdAt: T0, updatedAt: T0 }],
    });
    const title = buildTimeline(s, "2026-01-10").find((m) => m.key === "title_cleared")!;
    expect(title.health).toBe("blocked");
    expect(title.exceptions).toEqual(["Contractor lien"]);
  });
});

describe("jurisdictions", () => {
  it("every jurisdiction is internally consistent", () => {
    for (const j of Object.values(JURISDICTIONS)) {
      expect(j.requiredParticipants).toContain("buyer");
      expect(j.milestones[0]).toBe("offer_accepted");
      expect(j.milestones.at(-1)).toBe("ownership_transferred");
      expect(j.recording.confirmingRoles.length).toBeGreaterThan(0);
    }
  });
  it("does not pretend one workflow fits all markets", () => {
    expect(getJurisdiction("SE").escrow.available).toBe(false);
    expect(getJurisdiction("DE").signatures.notaryRequiredForDeed).toBe(true);
    expect(getJurisdiction("SE").milestones).not.toContain("title_cleared");
    expect(() => getJurisdiction("XX")).toThrow();
  });
});

describe("business acquisition profile (beta)", () => {
  const company = {
    id: "c", organizationId: null, legalName: "Blue Harbor Coffee Roasters, LLC", tradeName: "Blue Harbor Coffee", entityType: "llc" as const,
    stateOfFormation: "TX", industry: "Specialty coffee roasting", description: null, employeeCount: 14, annualRevenue: 180_000_000,
    dealStructure: "asset_purchase" as const, website: null, currency: "USD" as const, createdAt: T0, updatedAt: T0,
  };
  const biz = (patch: Partial<TransactionSnapshot> = {}) => {
    const base = snapshot("documents_pending", patch);
    return { ...base, company, transaction: { ...base.transaction, type: "business_acquisition" as const, companyId: "c", jurisdiction: "US-BUSINESS" }, ...patch };
  };

  it("uses the business vocabulary, documents and owners", () => {
    const j = getJurisdiction("US-BUSINESS");
    expect(j.vertical).toBe("business");
    const facts = evaluateAllFacts(biz());
    expect(facts.purchase_agreement_signed).toMatchObject({ value: false, responsibleRole: "attorney" });
    expect(facts.purchase_agreement_signed.detail).toContain("definitive agreement");
    expect(facts.inspection_completed).toMatchObject({ value: false, responsibleRole: "accountant" });
    expect(facts.inspection_completed.detail).toContain("due diligence report");
    expect(facts.deed_signed.detail).toContain("transfer documents");

    const signed = evaluateAllFacts(biz({ documents: [document("definitive_agreement", { signatureStatus: "completed" }), document("due_diligence_report")] }));
    expect(signed.purchase_agreement_signed.value).toBe(true);
    expect(signed.inspection_completed.value).toBe(true);
    // A real-estate purchase agreement doesn't satisfy a business deal.
    expect(evaluateAllFacts(biz({ documents: [document("purchase_agreement", { signatureStatus: "completed" })] })).purchase_agreement_signed.value).toBe(false);
  });

  it("labels the timeline and requirements for a business deal", () => {
    const tl = buildTimeline(biz(), "2026-01-01");
    expect(tl.map((m) => m.label)).toEqual([
      "LOI signed", "Deal room opened", "Parties verified", "Diligence documents in", "Financing approved", "Due diligence complete",
      "Lien search clear", "Closing documents signed", "Funds received", "Closing filings submitted", "Ownership transferred",
    ]);
    expect(tl[0]!.detail).toBe("Upload the signed letter of intent.");
    expect(buildTimeline(biz({ documents: [document("letter_of_intent")] }), "2026-01-01")[0]!.complete).toBe(true);
    const readiness = recordingReadiness(biz());
    expect(readiness.items.map((i) => i.label)).toContain("Transfer documents signed");
    expect(readiness.items.map((i) => i.label)).not.toContain("Deed signed");
  });

  it("keeps real estate wording unchanged", () => {
    const f = evaluateAllFacts(snapshot("documents_pending"));
    expect(f.purchase_agreement_signed.detail).toBe("The purchase agreement still needs every signature.");
    expect(f.deed_signed.detail).toBe("The deed hasn't been signed.");
    expect(recordingReadiness(snapshot("documents_pending")).items.map((i) => i.label)).toContain("Deed signed");
  });

  it("describes the deal subject", () => {
    expect(dealSubject(biz())).toMatchObject({ kind: "company", title: "Blue Harbor Coffee" });
    expect(dealSubject(biz()).subtitle).toContain("LLC");
    expect(dealSubject(snapshot("draft"))).toMatchObject({ kind: "property", title: "1 A St" });
  });

  it("confirms ownership only from counsel's confirmation reference", () => {
    const pending = evaluateAllFacts(biz({ recording: null }));
    expect(pending.ownership_recorded).toMatchObject({ value: false, responsibleRole: "attorney" });
  });
});
