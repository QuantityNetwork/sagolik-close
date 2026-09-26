/**
 * The critical end-to-end journey, through the real services:
 * create transaction → invite → verify identity → connect bank → upload →
 * request signature → signature webhook → escrow payment webhook → title
 * clear → recording → ownership transfer → close.
 *
 * Sandbox providers emit HMAC-signed webhooks into the real webhook pipeline.
 */
import { MOCK_SIGNATURE_HEADER } from "@sagolik/integrations";
import { signWebhookPayload } from "@sagolik/security";
import { beforeAll, describe, expect, it } from "vitest";
import {
  approvePayment,
  askAssistant,
  completeBankConnection,
  confirmRecording,
  createBankInstruction,
  createTransaction,
  decideComplianceCase,
  declareSourceOfFunds,
  getTransaction,
  handleWebhook,
  initiatePayment,
  inviteParticipant,
  claimInvitations,
  openEscrow,
  openMortgage,
  orderTitle,
  addTitleIssue,
  resolveTitleIssue,
  requestDisbursement,
  requestSignatures,
  reviewDocument,
  startBankConnection,
  startIdentityVerification,
  submitForRecording,
  transitionTransaction,
  updateMortgage,
  updateTitle,
  uploadDocument,
  verifyBankInstruction,
  exportAuditPackage,
  type AppError,
  toAppError,
} from "./index";
import { createTestHarness, type TestHarness } from "./testing";

const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n% ${label}\n%%EOF`);

async function expectAppError(p: Promise<unknown>, code: AppError["code"]) {
  try {
    await p;
  } catch (e) {
    expect(toAppError(e).code).toBe(code);
    return toAppError(e);
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe("closing lifecycle (in-memory, sandbox providers)", () => {
  let h: TestHarness;
  let txId: string;
  const ORG_REALTY = () => h.db.organizations.findOne({ slug: "morgan-co-realty-demo" }).then((o) => o!.id);

  beforeAll(async () => {
    h = await createTestHarness({ seed: false });
  });

  it("creates a transaction and invites the parties", async () => {
    const sofia = await h.as("sofia.alvarez");
    const tx = await createTransaction(sofia, {
      organizationId: await ORG_REALTY(),
      type: "purchase",
      jurisdiction: "US-TX",
      currency: "USD",
      salePrice: 40_000_000,
      expectedClosingDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      creatorRole: "transaction_coordinator",
      property: { addressLine1: "77 Test Hollow Lane", city: "Austin", region: "TX", postalCode: "78701", country: "US", propertyType: "single_family" },
    });
    txId = tx.id;
    expect(tx.state).toBe("draft");

    const invites = [
      ["buyer", "Olivia Carter", "olivia.carter@demo.sagolik.test"],
      ["seller", "Daniel Brooks", "daniel.brooks@demo.sagolik.test"],
      ["escrow_officer", "Marcus Lee", "marcus.lee@demo.sagolik.test"],
      ["title_officer", "Priya Shah", "priya.shah@demo.sagolik.test"],
      ["loan_officer", "Michael Reed", "michael.reed@demo.sagolik.test"],
    ] as const;
    for (const [role, displayName, email] of invites) await inviteParticipant(sofia, txId, { role, displayName, email });
    for (const key of ["olivia.carter", "daniel.brooks", "marcus.lee", "priya.shah", "michael.reed"]) {
      await claimInvitations(h.system(), await h.actorFor(h.userId(key)));
    }
    const s = await getTransaction(sofia, txId);
    expect(s.transaction.state).toBe("identity_pending");
    expect(s.tasks.filter((t) => t.actionKind === "verify_identity")).toHaveLength(2);
  });

  it("hides the transaction from outsiders (404, not 403)", async () => {
    const mia = await h.as("mia.rodriguez");
    await expectAppError(getTransaction(mia, txId), "not_found");
    const admin = await h.as("admin");
    await expectAppError(getTransaction(admin, txId), "not_found");
  });

  it("verifies identities via the provider's signed webhook", async () => {
    for (const key of ["olivia.carter", "daniel.brooks"]) {
      const ctx = await h.as(key);
      const url = await startIdentityVerification(ctx, txId, "http://localhost:3000/return");
      const inquiry = new URL(url).searchParams.get("inquiry")!;
      await h.providers.mocks.identity!.complete(inquiry, "approve");
    }
    const s = await getTransaction(await h.as("sofia.alvarez"), txId);
    expect(s.identityVerifications.every((v) => v.status === "verified")).toBe(true);
    expect(s.transaction.state).toBe("documents_pending");
    expect(s.tasks.filter((t) => t.actionKind === "verify_identity").every((t) => t.status === "complete")).toBe(true);
  });

  it("opens the loan and signs the purchase agreement through the signature webhook", async () => {
    await openMortgage(await h.as("michael.reed"), txId, { lenderName: "Harbor Lending (Demo)", loanAmount: 30_000_000, loanType: "30-year fixed", termMonths: 360 });
    const sofia = await h.as("sofia.alvarez");
    const { document } = await uploadDocument(sofia, { transactionId: txId, name: "Purchase Agreement", category: "purchase_agreement", filename: "purchase-agreement.pdf", bytes: pdf("PA") });
    const s = await getTransaction(sofia, txId);
    const buyer = s.participants.find((p) => p.role === "buyer")!;
    const seller = s.participants.find((p) => p.role === "seller")!;
    const sig = await requestSignatures(sofia, document.id, { signerParticipantIds: [buyer.id, seller.id] });
    await h.providers.mocks.signatures!.act(sig.externalEnvelopeId, buyer.id, "sign");
    let after = await getTransaction(sofia, txId);
    expect(after.documents.find((d) => d.id === document.id)!.signatureStatus).toBe("signed");
    await h.providers.mocks.signatures!.act(sig.externalEnvelopeId, seller.id, "sign");
    after = await getTransaction(sofia, txId);
    const pa = after.documents.find((d) => d.id === document.id)!;
    expect(pa.signatureStatus).toBe("completed");
    expect(pa.currentVersion).toBe(2); // signed copy stored as a NEW immutable version
    const versions = await h.db.document_versions.find({ documentId: document.id });
    expect(versions.map((v) => v.isSigned).sort()).toEqual([false, true]);
    expect(after.transaction.state).toBe("financing_pending");
  });

  it("rejects replayed and forged webhooks", async () => {
    const body = JSON.stringify({ externalEventId: "evt_replay_1", eventType: "envelope.sent", occurredAt: new Date().toISOString(), data: { externalEnvelopeId: "nope" } });
    const secret = "mock_webhook_secret_local_only";
    const forged = await handleWebhook(h.system(), "mock_signature", body, new Headers({ [MOCK_SIGNATURE_HEADER]: signWebhookPayload(body, "wrong-secret") }));
    expect(forged.status).toBe("rejected");
    const stale = await handleWebhook(h.system(), "mock_signature", body, new Headers({ [MOCK_SIGNATURE_HEADER]: signWebhookPayload(body, secret, Math.floor(Date.now() / 1000) - 3600) }));
    expect(stale.status).toBe("rejected");
    const header = new Headers({ [MOCK_SIGNATURE_HEADER]: signWebhookPayload(body, secret) });
    const first = await handleWebhook(h.system(), "mock_signature", body, header);
    expect(first.status).toBe("failed"); // unknown envelope → stored as failed for retry
    const unknownProvider = await handleWebhook(h.system(), "evil", body, header);
    expect(unknownProvider.status).toBe("rejected");
  });

  it("walks financing and title to clear", async () => {
    const michael = await h.as("michael.reed");
    // Buyers can never move their own loan.
    await expectAppError(updateMortgage(await h.as("olivia.carter"), txId, { status: "clear_to_close" }), "forbidden");
    await updateMortgage(michael, txId, { status: "conditional_approval", appraisalStatus: "completed", underwritingStatus: "approved" });
    const priya = await h.as("priya.shah");
    await orderTitle(priya, txId, { titleCompany: "Maple Title & Escrow (Demo)" });
    const issue = await addTitleIssue(priya, txId, { kind: "lien", description: "Old utility lien", amount: 10_000 });
    await expectAppError(updateTitle(priya, txId, { status: "clear" }), "bad_request");
    await resolveTitleIssue(priya, issue.id);
    await updateTitle(priya, txId, { status: "clear" });
    await updateMortgage(michael, txId, { status: "clear_to_close" });

    const sofia = await h.as("sofia.alvarez");
    for (const [name, category, by] of [
      ["Seller's Disclosure", "disclosure", "sofia.alvarez"],
      ["Inspection Report", "inspection", "sofia.alvarez"],
      ["Title Commitment", "title", "priya.shah"],
      ["Closing Disclosure", "closing_statement", "marcus.lee"],
    ] as const) {
      const { document } = await uploadDocument(await h.as(by), { transactionId: txId, name, category, filename: `${name}.pdf`, bytes: pdf(name) });
      await reviewDocument(await h.as("marcus.lee"), document.id, "approved");
    }
    const s = await getTransaction(sofia, txId);
    expect(s.transaction.state).toBe("ready_for_signing");
  });

  it("enforces verified, dual-controlled escrow instructions", async () => {
    const marcusNoStepUp = await h.as("marcus.lee");
    await expectAppError(openEscrow(marcusNoStepUp, txId, { requiredAmount: 10_000_000 }), "step_up_required");
    const marcus = await h.as("marcus.lee", { stepUp: true });
    await openEscrow(marcus, txId, { requiredAmount: 10_000_000 });
    const s = await getTransaction(marcus, txId);
    const ins = s.bankInstructions[0]!;
    expect(ins.status).toBe("pending_verification");
    expect(ins.encryptedAccountNumber).not.toContain("000123456789");
    // The person who entered the instructions can't verify them.
    await expectAppError(verifyBankInstruction(marcus, ins.id, "out_of_band_call"), "forbidden");
    await verifyBankInstruction(await h.as("priya.shah", { stepUp: true }), ins.id, "out_of_band_call");
  });

  it("connects the buyer's bank without ever handling credentials", async () => {
    const olivia = await h.as("olivia.carter");
    const { connectionId, redirectUrl } = await startBankConnection(olivia, { transactionId: txId, institutionId: "mock_chase", country: "US" }, "http://localhost:3000/cb");
    expect(new URL(redirectUrl).pathname).toBe("/sandbox/bank");
    const code = h.providers.mocks.banking!.approveConsent(connectionId);
    // Someone else can't complete Olivia's connection.
    await expectAppError(completeBankConnection(await h.as("daniel.brooks"), connectionId, code), "not_found");
    const conn = await completeBankConnection(olivia, connectionId, code);
    expect(conn.status).toBe("connected");
    const accounts = await h.db.bank_accounts.find({ connectionId });
    expect(accounts.length).toBe(2);
    expect(accounts.every((a) => a.ownershipVerified)).toBe(true);
    const secret = await h.db.bank_connection_secrets.findOne({ connectionId });
    expect(secret!.encryptedAccessToken).not.toContain("access-sandbox");
  });

  it("requires human compliance review of the source of funds", async () => {
    const olivia = await h.as("olivia.carter");
    await declareSourceOfFunds(olivia, txId, { sourceType: "salary_savings", amount: 10_000_000, currency: "USD", description: "Savings" });
    const s = await getTransaction(await h.as("marcus.lee"), txId);
    const c = s.complianceCases.find((x) => x.category === "source_of_funds")!;
    expect(c.status).toBe("review_required");
    await expectAppError(decideComplianceCase(olivia, c.id, { decision: "approved", notes: "self" }), "forbidden");
    await decideComplianceCase(await h.as("marcus.lee"), c.id, { decision: "approved", notes: "Statements reviewed." });
  });

  it("moves closing funds only with step-up + second approver, and settles only by webhook", async () => {
    const s = await getTransaction(await h.as("olivia.carter"), txId);
    const account = (await h.db.bank_accounts.find({ userId: h.userId("olivia.carter") })).find((a) => a.name.includes("Savings"))!;
    const input = { transactionId: txId, type: "closing_funds" as const, rail: "wire" as const, amount: 10_000_000, currency: "USD" as const, fromAccountId: account.id, bankInstructionId: s.bankInstructions[0]!.id };
    await expectAppError(initiatePayment(await h.as("olivia.carter"), input), "step_up_required");
    const olivia = await h.as("olivia.carter", { stepUp: true });
    const payment = await initiatePayment(olivia, input, "idem-closing-1");
    expect(payment.status).toBe("authorization_required");
    // Idempotent retry returns the same payment.
    expect((await initiatePayment(olivia, input, "idem-closing-1")).id).toBe(payment.id);
    // Buyers can't approve; approval needs escrow + step-up.
    await expectAppError(approvePayment(olivia, payment.id), "forbidden");
    await expectAppError(approvePayment(await h.as("marcus.lee"), payment.id), "step_up_required");
    const sent = await approvePayment(await h.as("marcus.lee", { stepUp: true }), payment.id);
    expect(sent.status).toBe("initiated");

    const pay = h.providers.mocks.payments!;
    await pay.advance(sent.externalPaymentId!); // processing
    await pay.advance(sent.externalPaymentId!); // received
    let now = await h.db.payments.get(payment.id);
    expect(now!.status).toBe("received");
    expect(now!.settledAt).toBeNull();
    await pay.advance(sent.externalPaymentId!); // settled
    now = await h.db.payments.get(payment.id);
    expect(now!.status).toBe("settled");
    const escrow = await h.db.escrow_accounts.findOne({ transactionId: txId });
    expect(escrow!.receivedAmount).toBe(10_000_000);
    expect(escrow!.status).toBe("funded");
  });

  it("changing instructions triggers fraud controls and blocks payment during cooling-off", async () => {
    const marcus = await h.as("marcus.lee", { stepUp: true });
    const changed = await createBankInstruction(marcus, txId, { purpose: "closing_funds_to_escrow", beneficiaryName: "Maple Title & Escrow (Demo) — Trust Account", bankName: "Another Sandbox Bank", accountNumber: "999988887777", routingIdentifier: "111000025", currency: "USD" });
    expect(changed.version).toBe(2);
    expect(changed.effectiveAfter).not.toBeNull();
    const signals = await h.db.security_signals.find({ transactionId: txId });
    expect(signals.some((x) => x.kind === "bank_instruction_changed")).toBe(true);
    const v1 = (await h.db.bank_instructions.find({ transactionId: txId })).find((b) => b.version === 1)!;
    expect(v1.status).toBe("superseded");
    const buyerNotices = await h.db.notifications.find({ userId: h.userId("olivia.carter"), kind: "payment_instructions_changed" });
    expect(buyerNotices.length).toBeGreaterThan(0);
    await verifyBankInstruction(await h.as("priya.shah", { stepUp: true }), changed.id, "out_of_band_call");
    const account = (await h.db.bank_accounts.find({ userId: h.userId("olivia.carter") }))[0]!;
    await expectAppError(
      initiatePayment(await h.as("olivia.carter", { stepUp: true }), { transactionId: txId, type: "fee", rail: "wire", amount: 100, currency: "USD", fromAccountId: account.id, bankInstructionId: changed.id }),
      "forbidden",
    );
  });

  it("completes signing, funding and recording — and only then transfers ownership", async () => {
    const priya = await h.as("priya.shah");
    const { document: deed } = await uploadDocument(priya, { transactionId: txId, name: "Special Warranty Deed", category: "deed", filename: "deed.pdf", bytes: pdf("deed") });
    await reviewDocument(await h.as("marcus.lee"), deed.id, "approved");
    let s = await getTransaction(priya, txId);
    const buyer = s.participants.find((p) => p.role === "buyer")!;
    const seller = s.participants.find((p) => p.role === "seller")!;
    const cd = s.documents.find((d) => d.category === "closing_statement")!;
    const marcus = await h.as("marcus.lee");
    const cdSig = await requestSignatures(marcus, cd.id, { signerParticipantIds: [buyer.id] });
    s = await getTransaction(priya, txId);
    expect(s.transaction.state).toBe("signing");
    const deedSig = await requestSignatures(marcus, deed.id, { signerParticipantIds: [seller.id] });
    await h.providers.mocks.signatures!.act(cdSig.externalEnvelopeId, buyer.id, "sign");
    await h.providers.mocks.signatures!.act(deedSig.externalEnvelopeId, seller.id, "sign");

    s = await getTransaction(priya, txId);
    // Signing complete + funds settled → escrow_pending → funding_pending; lender funding still outstanding.
    expect(s.transaction.state).toBe("funding_pending");
    expect(s.recording!.status).toBe("ready_for_recording");

    // Nobody can jump to ownership by "clicking a button".
    await expectAppError(
      transitionTransaction(await h.as("priya.shah"), txId, { to: "ownership_transfer", reason: "Trying to skip", expectedVersion: s.transaction.version }),
      "invalid_transition",
    );

    await updateMortgage(await h.as("michael.reed"), txId, { status: "funded" });
    s = await getTransaction(priya, txId);
    expect(s.transaction.state).toBe("recording_pending");

    await submitForRecording(priya, txId);
    await expectAppError(
      confirmRecording(await h.as("olivia.carter"), txId, { recordingReference: "X-1", registry: "County", recordedAt: new Date().toISOString(), attestation: true }),
      "forbidden",
    );
    await confirmRecording(priya, txId, { recordingReference: "TEST-2026-000123", registry: "Travis County Clerk — Real Property Records", recordedAt: new Date().toISOString(), attestation: true });
    s = await getTransaction(priya, txId);
    expect(s.transaction.state).toBe("ownership_transfer");
    const record = await h.db.ownership_records.findOne({ transactionId: txId });
    expect(record?.ownerNames).toEqual(["Olivia Carter"]);
    expect((await h.db.ownership_record_items.find({ ownershipRecordId: record!.id })).some((i) => i.kind === "signed_document")).toBe(true);
    // Close → Live: the property moves straight into Property Autopilot (monitoring only).
    const passport = await h.db.property_passports.findOne({ ownershipRecordId: record!.id });
    expect(passport).toMatchObject({ status: "live", monitoring: "monitor", origin: "sagolik_closing" });
    const costs = await h.db.obligations.find({ passportId: passport!.id });
    // No tax amount was on file for this property, so none is invented: the owner is asked for it.
    expect(costs.map((c) => c.kind).sort()).toEqual(["electricity", "insurance", "mortgage", "water"]);
    expect(costs.every((c) => c.status === "suggested")).toBe(true); // inferred, so the owner confirms
    const funding = await h.db.funding_rules.findOne({ passportId: passport!.id });
    expect(funding!.operatingAccountId).not.toBeNull(); // the account whose ownership was verified at closing
  });

  it("closes the file after escrow disburses", async () => {
    const marcus = await h.as("marcus.lee", { stepUp: true });
    let s = await getTransaction(marcus, txId);
    await expectAppError(transitionTransaction(marcus, txId, { to: "closed", reason: "Done", expectedVersion: s.transaction.version }), "invalid_transition");
    await requestDisbursement(marcus, txId);
    await h.providers.mocks.escrow!.confirmDisbursed(s.escrow!.externalReference);
    s = await getTransaction(marcus, txId);
    await transitionTransaction(marcus, txId, { to: "closed", reason: "Disbursement confirmed.", expectedVersion: s.transaction.version });
    s = await getTransaction(marcus, txId);
    expect(s.transaction.state).toBe("closed");
    expect(s.transaction.closedAt).not.toBeNull();
  });

  it("keeps a complete, append-only audit trail", async () => {
    const actions = new Set((await h.db.audit_events.find({ transactionId: txId })).map((a) => a.action));
    for (const a of [
      "transaction.created",
      "participant.invited",
      "identity.completed",
      "document.uploaded",
      "signature.requested",
      "signature.completed",
      "bank.connected",
      "bank_instruction.created",
      "beneficiary.changed",
      "bank_instruction.verified",
      "payment.initiated",
      "payment.approved",
      "payment.settled",
      "transaction.state_changed",
      "recording.submitted",
      "ownership.recorded",
    ]) {
      expect(actions, a).toContain(a);
    }
    const [first] = await h.db.audit_events.find({ transactionId: txId }, { limit: 1 });
    await expect(h.db.audit_events.update(first!.id, { action: "tampered" })).rejects.toThrow(/append-only/);
    const transitions = await h.db.transaction_events.find({ transactionId: txId }, { orderBy: "occurredAt" });
    expect(transitions.map((t) => t.toState)).toContain("ownership_transfer");
    expect(transitions.every((t) => t.correlationId.length > 0)).toBe(true);

    await expectAppError(exportAuditPackage(await h.as("olivia.carter", { stepUp: true }), txId), "forbidden");
    await expectAppError(exportAuditPackage(await h.as("priya.shah", { stepUp: true }), txId), "forbidden");
    const pkg = await exportAuditPackage(await h.as("sofia.alvarez", { stepUp: true }), txId);
    expect(pkg.json).not.toContain("encryptedAccountNumber");
    expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers from structured data and declines regulated actions", async () => {
    const olivia = await h.as("olivia.carter");
    const a = await askAssistant(olivia, txId, "Please send my closing funds");
    expect(a.declined).toBe(true);
    const b = await askAssistant(olivia, txId, "How much money is in escrow?");
    expect(b.declined).toBe(false);
    expect(b.bullets.join(" ")).toContain("$400,000");
  });
});
