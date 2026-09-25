import { describe, expect, it } from "vitest";
import { dealSubject } from "@sagolik/workflow";
import { createTransaction, loadSnapshot, toAppError } from "./index";
import { createTestHarness } from "./testing";

const deal = (organizationId: string, patch: Record<string, unknown> = {}) => ({
  organizationId,
  type: "business_acquisition" as const,
  jurisdiction: "US-BUSINESS",
  currency: "USD" as const,
  salePrice: 45_000_000,
  creatorRole: "broker" as const,
  property: { addressLine1: "12 Market Street", city: "Austin", region: "TX", country: "US", propertyType: "business_premises" },
  company: { legalName: "Fictional Print Shop, Inc.", entityType: "s_corporation" as const, stateOfFormation: "tx", industry: "Commercial printing", dealStructure: "stock_purchase" as const },
  ...patch,
});

describe("business acquisitions (beta)", () => {
  it("opens a deal with the company, business milestones and LOI task", async () => {
    const h = await createTestHarness();
    const rachel = await h.as("rachel.kim");
    const org = (await h.db.organization_members.findOne({ userId: h.userId("rachel.kim") }))!.organizationId;
    const tx = await createTransaction(rachel, deal(org));
    expect(tx).toMatchObject({ type: "business_acquisition", jurisdiction: "US-BUSINESS" });
    const s = (await loadSnapshot(rachel, tx.id))!;
    expect(s.company).toMatchObject({ legalName: "Fictional Print Shop, Inc.", stateOfFormation: "TX", dealStructure: "stock_purchase" });
    expect(s.property.propertyType).toBe("business_premises");
    expect(dealSubject(s).title).toBe("Fictional Print Shop, Inc.");
    expect(s.milestones.find((m) => m.key === "inspection_completed")?.ownerRole).toBe("accountant");
    expect(s.tasks.map((t) => t.title)).toContain("Upload the signed letter of intent");
  });

  it("refuses mismatched deal types and workflows", async () => {
    const h = await createTestHarness();
    const rachel = await h.as("rachel.kim");
    const org = (await h.db.organization_members.findOne({ userId: h.userId("rachel.kim") }))!.organizationId;
    const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => toAppError(e).code);
    expect(await code(createTransaction(rachel, deal(org, { company: undefined })))).toBe("bad_request");
    expect(await code(createTransaction(rachel, deal(org, { jurisdiction: "US-TX" })))).toBe("bad_request");
    expect(await code(createTransaction(rachel, deal(org, { type: "purchase", company: undefined })))).toBe("bad_request");
  });
});
