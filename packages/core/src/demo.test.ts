import { describe, expect, it } from "vitest";
import { buildTimeline, dealSubject } from "@sagolik/workflow";
import { askAssistant, DEMO_BUSINESS_TRANSACTION_ID, DEMO_TRANSACTION_ID, getTransaction, loadSnapshot, reconcile, transactionView, commandCenter, listDocuments, openDocument } from "./index";
import { createTestHarness } from "./testing";

describe("demo environment", () => {
  it("loads, validates against the row schemas, and is internally consistent", async () => {
    const h = await createTestHarness({ seed: true });
    const txs = await h.db.transactions.find({});
    expect(txs.length).toBe(5);
    // Seeded states must already satisfy the workflow: reconciling moves nothing.
    for (const t of txs) expect(await reconcile(h.system(), t.id), t.reference).toEqual([]);
  });

  it("shows Olivia a clear next step on 1234 Maple Ridge Drive", async () => {
    const h = await createTestHarness({ seed: true });
    const olivia = await h.as("olivia.carter");
    const view = transactionView(olivia, await getTransaction(olivia, DEMO_TRANSACTION_ID));
    expect(view.snapshot.property.addressLine1).toBe("1234 Maple Ridge Drive");
    expect(view.nextAction?.title).toBe("Review and sign Closing Disclosure");
    expect(view.phase?.key).toBe("signing_complete");
    // Olivia can't see Daniel's restricted ID record: 15 of 16 documents are visible.
    expect(view.documents.total).toBe(15);
    expect(view.documents.needsAttention).toBe(2);
    const answer = await askAssistant(olivia, DEMO_TRANSACTION_ID, "What is holding up my closing?");
    expect(answer.bullets.join(" ")).toMatch(/Clear to Close|funded|signature/i);
  });

  it("enforces document classification in the demo vault", async () => {
    const h = await createTestHarness({ seed: true });
    const olivia = await h.as("olivia.carter");
    const { documents } = await listDocuments(olivia, DEMO_TRANSACTION_ID);
    const names = documents.map((d) => d.document.name);
    expect(names).toContain("Olivia Carter — ID verification record");
    expect(names).not.toContain("Daniel Brooks — ID verification record");
    const file = await openDocument(olivia, documents[0]!.document.id);
    expect(file.kind).toBe("bytes");
  });

  it("gives professionals real KPIs over what they can see", async () => {
    const h = await createTestHarness({ seed: true });
    const { kpis, rows } = await commandCenter(await h.as("jessica.morgan"));
    expect(kpis.openTransactions).toBe(3);
    expect(kpis.titleIssues).toBe(1);
    expect(kpis.identityReviews).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.property === "88 Barton Creek Boulevard")!.blocked).toBe(true);
    // The loan officer only sees files they're on.
    const michael = await commandCenter(await h.as("michael.reed"));
    expect(michael.rows.every((r) => r.property !== "2201 Hillside Avenue")).toBe(true);
  });

  it("includes a fictional business acquisition in due diligence (beta)", async () => {
    const h = await createTestHarness({ seed: true });
    const tx = (await h.db.transactions.get(DEMO_BUSINESS_TRANSACTION_ID))!;
    expect(tx).toMatchObject({ type: "business_acquisition", jurisdiction: "US-BUSINESS", state: "financing_pending" });
    const company = (await h.db.companies.get(tx.companyId!))!;
    expect(company.legalName).toBe("Blue Harbor Coffee Roasters, LLC");
    const ctx = await h.as("amara.okafor");
    const s = (await loadSnapshot(ctx, tx.id))!;
    expect(dealSubject(s)).toMatchObject({ kind: "company", title: "Blue Harbor Coffee" });
    const timeline = buildTimeline(s);
    expect(timeline[0]).toMatchObject({ label: "LOI signed", complete: true });
    expect(timeline.find((m) => m.current)?.label).toBe("Financing approved");
    // The accountant can see the deal but not its money.
    const grace = await h.as("grace.liu");
    const gs = (await loadSnapshot(grace, tx.id))!;
    expect(gs.participants.find((p) => p.userId === h.userId("grace.liu"))?.role).toBe("accountant");
  });
});
