/**
 * Demo environment — clearly fictional people, companies and properties.
 *
 * The same builder feeds the in-memory store (local demo mode) and
 * `supabase/seed.sql` (via `pnpm gen:seed`), so both modes show identical
 * data. Dates are relative to "now" so the demo never goes stale.
 *
 * No real person, company, account or address is represented. Emails use the
 * reserved `.test` TLD.
 */
import { createHash } from "node:crypto";
import type { Db } from "@sagolik/database";
import { encryptField, type KeyRing, sha256Hex } from "@sagolik/security";
import type { Bill, Obligation, Row, TableName } from "@sagolik/types";
import { addMonths, assessPortfolio, defaultReviewPolicies, type PassportInput } from "@sagolik/workflow";
import { objectKey } from "../storage";

/** Deterministic, valid v4-shaped UUID from a label (stable demo URLs). */
export function did(label: string): string {
  const h = createHash("sha256").update(`sagolik-demo:${label}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const DEMO_PASSWORD = "demo-closing-2026";
export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export interface DemoPersona {
  key: string;
  userId: string;
  name: string;
  email: string;
  title: string;
  description: string;
  home: string;
}

const persona = (key: string, name: string, title: string, description: string, home = "/app"): DemoPersona => ({
  key,
  userId: did(`user:${key}`),
  name,
  email: `${key}@demo.sagolik.test`,
  title,
  description,
  home,
});

export const DEMO_PERSONAS: DemoPersona[] = [
  persona("olivia.carter", "Olivia Carter", "Buyer", "First-time home buyer closing on 1234 Maple Ridge Drive."),
  persona("daniel.brooks", "Daniel Brooks", "Seller", "Selling 1234 Maple Ridge Drive; needs to sign the deed."),
  persona("jessica.morgan", "Jessica Morgan", "Buyer's agent", "Agent at Morgan & Co. Realty (demo) with several open files.", "/app/command-center"),
  persona("sofia.alvarez", "Sofia Alvarez", "Transaction coordinator", "Coordinator and organization admin at Morgan & Co. Realty (demo).", "/app/command-center"),
  persona("michael.reed", "Michael Reed", "Loan officer", "Loan officer at Harbor Lending (demo).", "/app/command-center"),
  persona("marcus.lee", "Marcus Lee", "Escrow officer", "Escrow officer at Maple Title & Escrow (demo).", "/app/command-center"),
  persona("priya.shah", "Priya Shah", "Title officer", "Title officer at Maple Title & Escrow (demo).", "/app/command-center"),
  persona("ethan.walker", "Ethan Walker", "Seller's agent", "Listing agent for 1234 Maple Ridge Drive.", "/app/command-center"),
  persona("mia.rodriguez", "Mia Rodriguez", "Homeowner", "Closed on 2201 Hillside Avenue last month — see the Home Record.", "/app/ownership"),
  // Business acquisition (beta) — all people and companies are fictional.
  persona("amara.okafor", "Amara Okafor", "Business buyer", "Buying Blue Harbor Coffee Roasters (fictional) with acquisition financing."),
  persona("tom.becker", "Tom Becker", "Business seller", "Founder selling Blue Harbor Coffee Roasters (fictional)."),
  persona("rachel.kim", "Rachel Kim", "M&A advisor", "Advisor at Kim Business Advisors (demo), running the sale.", "/app/command-center"),
  persona("david.chen", "David Chen", "Deal counsel", "Buyer's counsel at Chen Legal (demo); confirms the ownership transfer.", "/app/command-center"),
  persona("grace.liu", "Grace Liu", "Accountant", "Quality-of-earnings accountant at Liu & Partners CPAs (demo).", "/app/command-center"),
  // Property Autopilot — a fictional owner with five fictional properties.
  persona("alex.morgan", "Alex Morgan", "Property owner", "Owns five properties through Morgan Family Holdings (fictional). See Property Autopilot.", "/app/autopilot"),
  persona("admin", "Sagolik Operations (demo)", "Platform admin", "Internal Sagolik admin console. No implicit access to transaction data.", "/admin"),
];

/** Personas on the fictional business acquisition (beta). */
export const BUSINESS_PERSONA_KEYS: readonly string[] = ["amara.okafor", "tom.becker", "rachel.kim", "david.chen", "grace.liu"];

const P = Object.fromEntries(DEMO_PERSONAS.map((p) => [p.key, p])) as Record<string, DemoPersona>;

export const DEMO_TRANSACTION_ID = did("tx:maple");
/** Personas for Property Autopilot (after closing). */
export const AUTOPILOT_PERSONA_KEYS: readonly string[] = ["alex.morgan"];

/** Alex Morgan's fictional portfolio (Property Autopilot demo). */
export const DEMO_PORTFOLIO_ORG_ID = did("org:morgan-holdings");
export const DEMO_PASSPORTS = {
  miami: did("passport:miami"),
  manhattan: did("passport:manhattan"),
  austin1: did("passport:austin1"),
  austin2: did("passport:austin2"),
  aspen: did("passport:aspen"),
} as const;

/** The fictional business acquisition (beta). */
export const DEMO_BUSINESS_TRANSACTION_ID = did("tx:blueharbor");

export type DemoRows = { [K in TableName]?: Array<Row<K>> };

export interface DemoData {
  rows: DemoRows;
  files: Array<{ key: string; bytes: Uint8Array; mimeType: string }>;
}

function demoPdf(title: string, lines: string[]): Uint8Array {
  const body = [
    "%PDF-1.4",
    "% SAGOLIK CLOSE DEMO DOCUMENT — FICTIONAL, NOT A LEGAL INSTRUMENT",
    `% ${title}`,
    ...lines.map((l) => `% ${l}`),
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");
  return new TextEncoder().encode(body);
}

export function buildDemoData(now: Date, keyRing: KeyRing): DemoData {
  const rows: Required<Pick<DemoRows, TableName>> = {} as Required<DemoRows>;
  const add = <K extends TableName>(table: K, row: Row<K>) => {
    ((rows[table] ??= []) as Array<Row<K>>).push(row);
    return row;
  };
  const files: DemoData["files"] = [];

  const day = (offset: number, hour = 15) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const date = (offset: number) => day(offset).slice(0, 10);
  const base = (offset: number) => ({ createdAt: day(offset), updatedAt: day(offset) });

  // ------------------------------------------------------------------ people & organizations
  for (const p of DEMO_PERSONAS) {
    add("profiles", {
      id: p.userId,
      email: p.email,
      fullName: p.name,
      phone: null,
      locale: "en",
      avatarUrl: null,
      isPlatformAdmin: p.key === "admin",
      ...base(-60),
    });
  }

  const orgs = {
    realty: { id: did("org:realty"), name: "Morgan & Co. Realty (Demo)", slug: "morgan-co-realty-demo", type: "real_estate_agency" as const },
    title: { id: did("org:title"), name: "Maple Title & Escrow (Demo)", slug: "maple-title-escrow-demo", type: "title_company" as const },
    lender: { id: did("org:lender"), name: "Harbor Lending (Demo)", slug: "harbor-lending-demo", type: "mortgage_lender" as const },
    advisory: { id: did("org:advisory"), name: "Kim Business Advisors (Demo)", slug: "kim-business-advisors-demo", type: "ma_advisory" as const },
    law: { id: did("org:law"), name: "Chen Legal (Demo)", slug: "chen-legal-demo", type: "law_firm" as const },
    accounting: { id: did("org:accounting"), name: "Liu & Partners CPAs (Demo)", slug: "liu-partners-cpas-demo", type: "accounting_firm" as const },
  };
  for (const o of Object.values(orgs)) {
    add("organizations", { ...o, jurisdiction: "US-TX", ...base(-90) });
    add("organization_settings", { id: did(`orgset:${o.slug}`), organizationId: o.id, defaultJurisdiction: "US-TX", defaultCurrency: "USD", requireDualApproval: true, coolingOffHours: 24, ...base(-90) });
  }
  const member = (org: string, key: string, role: "organization_admin" | "member" | "auditor") =>
    add("organization_members", { id: did(`mem:${org}:${key}`), organizationId: org, userId: P[key]!.userId, role, ...base(-90) });
  member(orgs.realty.id, "sofia.alvarez", "organization_admin");
  member(orgs.realty.id, "jessica.morgan", "member");
  member(orgs.realty.id, "ethan.walker", "member");
  member(orgs.title.id, "marcus.lee", "organization_admin");
  member(orgs.title.id, "priya.shah", "member");
  member(orgs.lender.id, "michael.reed", "organization_admin");
  member(orgs.advisory.id, "rachel.kim", "organization_admin");
  member(orgs.law.id, "david.chen", "organization_admin");
  member(orgs.accounting.id, "grace.liu", "organization_admin");

  add("plans", { id: did("plan:consumer"), key: "consumer", name: "Consumer", audience: "consumer", priceMonthly: null, currency: "USD", features: ["Invited by your agent or escrow", "Your closing, documents and money in one place", "Home Record after closing"], active: true, sortOrder: 1, ...base(-90) });
  add("plans", { id: did("plan:professional"), key: "professional", name: "Professional", audience: "professional", priceMonthly: null, currency: "USD", features: ["Transaction workspaces", "Command center across your files", "E-signature and identity checks through connected providers"], active: true, sortOrder: 2, ...base(-90) });
  add("plans", { id: did("plan:team"), key: "team", name: "Team", audience: "team", priceMonthly: null, currency: "USD", features: ["Everything in Professional", "Shared portfolio and coordination", "Organization roles and permissions"], active: true, sortOrder: 3, ...base(-90) });
  add("plans", { id: did("plan:enterprise"), key: "enterprise", name: "Enterprise", audience: "enterprise", priceMonthly: null, currency: "USD", features: ["SAML single sign-on", "REST API and signed webhooks", "Audit exports for your compliance team"], active: true, sortOrder: 4, ...base(-90) });

  // ------------------------------------------------------------------ helpers per transaction
  interface TxSpec {
    key: string;
    address: string;
    city: string;
    postal: string;
    price: number;
    loan: number | null;
    closingOffset: number;
    openedOffset: number;
    state: Row<"transactions">["state"];
    buyer: { key?: string; name: string };
    seller: { key?: string; name: string };
    image: string;
    beds: number;
    baths: number;
    area: number;
    year: number;
  }

  const txBase = (spec: TxSpec) => {
    const id = spec.key === "maple" ? DEMO_TRANSACTION_ID : did(`tx:${spec.key}`);
    const propertyId = did(`prop:${spec.key}`);
    add("properties", {
      id: propertyId,
      organizationId: orgs.realty.id,
      addressLine1: spec.address,
      addressLine2: null,
      city: spec.city,
      region: "TX",
      postalCode: spec.postal,
      country: "US",
      latitude: null,
      longitude: null,
      parcelId: `DEMO-${spec.postal}-${spec.key.toUpperCase()}`,
      propertyType: "single_family",
      yearBuilt: spec.year,
      livingArea: spec.area,
      areaUnit: "sqft",
      bedrooms: spec.beds,
      bathrooms: spec.baths,
      lotSize: 0.28,
      imageUrls: [spec.image],
      propertyTaxAnnual: Math.round(spec.price * 0.018),
      hoaMonthly: 8500,
      energyRating: null,
      legalDescription: `Lot ${spec.key.length}, Block C, fictional ${spec.city} demo subdivision`,
      currency: "USD",
      ...base(spec.openedOffset),
    });
    add("transactions", {
      id,
      organizationId: orgs.realty.id,
      propertyId,
      companyId: null,
      reference: `SC-DEMO-${spec.key.toUpperCase()}`,
      type: "purchase",
      state: spec.state,
      jurisdiction: "US-TX",
      currency: "USD",
      salePrice: spec.price,
      expectedClosingDate: date(spec.closingOffset),
      coordinatorId: P["sofia.alvarez"]!.userId,
      createdBy: P["sofia.alvarez"]!.userId,
      stateChangedAt: day(-2),
      closedAt: spec.state === "closed" ? day(spec.closingOffset) : null,
      version: 12,
      ...base(spec.openedOffset),
    });
    const part = (role: Row<"transaction_participants">["role"], who: { key?: string; name: string }, orgId: string | null = null) => {
      const email = who.key ? P[who.key]!.email : `${who.name.toLowerCase().replace(/[^a-z]+/g, ".")}@demo.sagolik.test`;
      return add("transaction_participants", {
        id: did(`part:${spec.key}:${role}`),
        transactionId: id,
        userId: who.key ? P[who.key]!.userId : null,
        organizationId: orgId,
        role,
        displayName: who.name,
        email,
        status: who.key ? "active" : "invited",
        invitedBy: P["sofia.alvarez"]!.userId,
        joinedAt: who.key ? day(spec.openedOffset + 1) : null,
        ...base(spec.openedOffset),
      });
    };
    const parts = {
      coordinator: part("transaction_coordinator", { key: "sofia.alvarez", name: "Sofia Alvarez" }, orgs.realty.id),
      buyer: part("buyer", spec.buyer),
      seller: part("seller", spec.seller),
      buyerAgent: part("buyer_agent", { key: "jessica.morgan", name: "Jessica Morgan" }, orgs.realty.id),
      sellerAgent: part("seller_agent", { key: "ethan.walker", name: "Ethan Walker" }, orgs.realty.id),
      loan: spec.loan ? part("loan_officer", { key: "michael.reed", name: "Michael Reed" }, orgs.lender.id) : null,
      title: part("title_officer", { key: "priya.shah", name: "Priya Shah" }, orgs.title.id),
      escrow: part("escrow_officer", { key: "marcus.lee", name: "Marcus Lee" }, orgs.title.id),
    };
    const owners: Record<string, Row<"transaction_participants">["role"]> = {
      offer_accepted: "buyer_agent",
      transaction_opened: "transaction_coordinator",
      identity_verified: "buyer",
      documents_received: "transaction_coordinator",
      financing_approved: "loan_officer",
      inspection_completed: "buyer_agent",
      title_cleared: "title_officer",
      signing_complete: "escrow_officer",
      funds_received: "buyer",
      recording_submitted: "title_officer",
      ownership_transferred: "title_officer",
    };
    const dues: Record<string, number> = { identity_verified: -20, documents_received: -14, financing_approved: -7, inspection_completed: -12, title_cleared: -5, signing_complete: -1, funds_received: -1, recording_submitted: 0, ownership_transferred: 0 };
    for (const [key, role] of Object.entries(owners)) {
      add("transaction_milestones", {
        id: did(`ms:${spec.key}:${key}`),
        transactionId: id,
        key: key as Row<"transaction_milestones">["key"],
        ownerRole: role,
        dueDate: key in dues ? date(spec.closingOffset + dues[key]!) : null,
        completedAt: null,
        ...base(spec.openedOffset),
      });
    }
    add("message_threads", { id: did(`room:${spec.key}`), transactionId: id, kind: "transaction_room", title: "Transaction room", memberUserIds: [], ...base(spec.openedOffset) });
    return { id, propertyId, parts };
  };

  let docCount = 0;
  const doc = (
    txKey: string,
    txId: string,
    name: string,
    category: Row<"documents">["category"],
    opts: { status?: Row<"documents">["status"]; signatureStatus?: Row<"documents">["signatureStatus"]; accessLevel?: Row<"documents">["accessLevel"]; uploadedBy?: string; offset?: number; signedVersion?: boolean } = {},
  ) => {
    docCount++;
    const id = did(`doc:${txKey}:${name}`);
    const offset = opts.offset ?? -20;
    const signed = opts.signedVersion ?? false;
    const versions = signed ? 2 : 1;
    for (let v = 1; v <= versions; v++) {
      const bytes = demoPdf(`${name} (v${v}${v === 2 ? ", signed" : ""})`, [`Transaction ${txKey}`, `Demo document ${docCount}`]);
      const sha = sha256Hex(bytes);
      const key = objectKey(txId, id, v, sha);
      files.push({ key, bytes, mimeType: "application/pdf" });
      add("document_versions", {
        id: did(`docv:${txKey}:${name}:${v}`),
        documentId: id,
        transactionId: txId,
        version: v,
        storagePath: key,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        sha256: sha,
        uploadedBy: v === 1 ? (opts.uploadedBy ?? P["sofia.alvarez"]!.userId) : null,
        scanStatus: "clean",
        extractedFields: [],
        isSigned: v === 2,
        createdAt: day(offset + v - 1),
      });
    }
    return add("documents", {
      id,
      transactionId: txId,
      name,
      category,
      currentVersion: versions,
      status: opts.status ?? "approved",
      signatureStatus: opts.signatureStatus ?? (signed ? "completed" : "not_required"),
      accessLevel: opts.accessLevel ?? "all_participants",
      retentionPolicy: category === "identity" ? "identity_minimum" : "transaction_plus_10y",
      uploadedBy: opts.uploadedBy ?? P["sofia.alvarez"]!.userId,
      expiresAt: null,
      ...base(offset),
    });
  };

  const verifyId = (txKey: string, txId: string, participant: Row<"transaction_participants">, status: Row<"identity_verifications">["status"] = "verified") =>
    add("identity_verifications", {
      id: did(`idv:${txKey}:${participant.role}`),
      transactionId: txId,
      participantId: participant.id,
      userId: participant.userId,
      provider: "mock_identity",
      externalId: `inq_demo_${txKey}_${participant.role}`,
      status,
      checks:
        status === "verified"
          ? { document: "verified", liveness: "verified", address: "verified", sanctions: "verified", pep: "verified" }
          : { document: "verified", liveness: "verified", address: "verified", sanctions: "verified", pep: "review_required" },
      verifiedAt: status === "verified" ? day(-24) : null,
      expiresAt: status === "verified" ? day(150) : null,
      failureReason: status === "review_required" ? "A possible politically-exposed-person match needs manual review." : null,
      ...base(-25),
    });

  const task = (txKey: string, txId: string, title: string, t: Partial<Row<"tasks">> & Pick<Row<"tasks">, "actionKind">) =>
    add("tasks", {
      id: did(`task:${txKey}:${title}`),
      transactionId: txId,
      milestoneKey: null,
      title,
      description: null,
      assigneeParticipantId: null,
      status: "todo",
      priority: "normal",
      dueDate: null,
      requiredEvidence: null,
      relatedEntityType: null,
      relatedEntityId: null,
      estimatedMinutes: null,
      completedAt: null,
      completedBy: null,
      createdBy: P["sofia.alvarez"]!.userId,
      ...base(-20),
      ...t,
    });

  const event = (txId: string, from: Row<"transaction_events">["fromState"], to: Row<"transaction_events">["toState"], offset: number, reason: string, actor: string | null) =>
    add("transaction_events", {
      id: did(`evt:${txId}:${to}`),
      transactionId: txId,
      eventType: "transaction.state_changed",
      fromState: from,
      toState: to,
      actorId: actor,
      actorType: actor ? "user" : "system",
      reason,
      source: actor ? "user" : "workflow",
      relatedEntityType: null,
      relatedEntityId: null,
      ipAddress: null,
      correlationId: `corr_demo_${to}`,
      payload: {},
      occurredAt: day(offset),
    });

  const sysMsg = (txKey: string, txId: string, body: string, offset: number, authorKey?: string) =>
    add("messages", {
      id: did(`msg:${txKey}:${body.slice(0, 40)}`),
      threadId: did(`room:${txKey}`),
      transactionId: txId,
      authorId: authorKey ? P[authorKey]!.userId : null,
      kind: authorKey ? "user" : "system",
      body,
      mentions: [],
      attachmentDocumentIds: [],
      relatedEntityType: null,
      relatedEntityId: null,
      createdAt: day(offset, 14),
    });

  // ------------------------------------------------------------------ 1. 1234 Maple Ridge Drive — signing
  const maple = txBase({
    key: "maple",
    address: "1234 Maple Ridge Drive",
    city: "Austin",
    postal: "78746",
    price: 82_500_000,
    loan: 60_000_000,
    closingOffset: 6,
    openedOffset: -32,
    state: "signing",
    buyer: { key: "olivia.carter", name: "Olivia Carter" },
    seller: { key: "daniel.brooks", name: "Daniel Brooks" },
    image: "/images/homes/maple-ridge.jpg",
    beds: 4,
    baths: 3,
    area: 2643,
    year: 2016,
  });
  const M = maple.id;
  const mp = maple.parts;
  const u = (k: string) => P[k]!.userId;

  verifyId("maple", M, mp.buyer);
  verifyId("maple", M, mp.seller);

  doc("maple", M, "Purchase Agreement", "purchase_agreement", { signedVersion: true, offset: -31 });
  doc("maple", M, "Seller's Disclosure Notice", "disclosure", { offset: -30 });
  doc("maple", M, "Lead-Based Paint Disclosure", "disclosure", { offset: -30 });
  doc("maple", M, "HOA Addendum", "other", { offset: -29 });
  doc("maple", M, "Home Inspection Report", "inspection", { offset: -24, uploadedBy: u("jessica.morgan") });
  doc("maple", M, "Appraisal Report", "appraisal", { offset: -15, uploadedBy: u("michael.reed") });
  doc("maple", M, "Loan Estimate", "mortgage", { offset: -27, uploadedBy: u("michael.reed") });
  doc("maple", M, "Clear to Close Letter", "mortgage", { offset: -3, uploadedBy: u("michael.reed") });
  doc("maple", M, "Title Commitment", "title", { offset: -18, uploadedBy: u("priya.shah") });
  doc("maple", M, "Survey", "other", { offset: -16, uploadedBy: u("priya.shah") });
  doc("maple", M, "Homeowner's Insurance Binder", "insurance", { offset: -8, uploadedBy: u("olivia.carter") });
  doc("maple", M, "Earnest Money Receipt", "escrow", { offset: -26, uploadedBy: u("marcus.lee") });
  doc("maple", M, "Olivia Carter — ID verification record", "identity", { accessLevel: "restricted", uploadedBy: u("olivia.carter"), offset: -25 });
  doc("maple", M, "Daniel Brooks — ID verification record", "identity", { accessLevel: "restricted", uploadedBy: u("daniel.brooks"), offset: -25 });
  const cd = doc("maple", M, "Closing Disclosure", "closing_statement", { signatureStatus: "sent", offset: -2, uploadedBy: u("marcus.lee") });
  const deed = doc("maple", M, "Special Warranty Deed", "deed", { signatureStatus: "sent", offset: -2, uploadedBy: u("priya.shah") });

  // Signature envelopes out for signing (restored into the sandbox provider on startup).
  const envelope = (d: Row<"documents">, signer: Row<"transaction_participants">) => {
    const sigId = did(`sig:${d.id}`);
    const externalEnvelopeId = `env_demo_${d.category}`;
    add("document_signatures", {
      id: sigId,
      documentId: d.id,
      transactionId: M,
      documentVersion: d.currentVersion,
      provider: "mock_signature",
      externalEnvelopeId,
      status: "sent",
      requestedBy: u("marcus.lee"),
      recipients: [{ participantId: signer.id, name: signer.displayName, email: signer.email, status: "sent", signedAt: null }],
      sentAt: day(-1),
      completedAt: null,
      certificatePath: null,
      ...base(-1),
    });
    return sigId;
  };
  const cdSig = envelope(cd, mp.buyer);
  const deedSig = envelope(deed, mp.seller);

  task("maple", M, "Review and sign Closing Disclosure", {
    actionKind: "sign_document",
    assigneeParticipantId: mp.buyer.id,
    milestoneKey: "signing_complete",
    priority: "urgent",
    estimatedMinutes: 3,
    description: "Check the final numbers — loan terms, closing costs and cash to close — and sign.",
    relatedEntityType: "document_signature",
    relatedEntityId: cdSig,
    dueDate: date(3),
  });
  task("maple", M, "Send closing funds to escrow", {
    actionKind: "transfer_funds",
    assigneeParticipantId: mp.buyer.id,
    milestoneKey: "funds_received",
    priority: "high",
    estimatedMinutes: 5,
    description: "Send your remaining funds using the verified escrow instructions on the Money page. Confirm by phone with Marcus before sending.",
    dueDate: date(5),
  });
  task("maple", M, "Review and sign Special Warranty Deed", {
    actionKind: "sign_document",
    assigneeParticipantId: mp.seller.id,
    milestoneKey: "signing_complete",
    priority: "urgent",
    estimatedMinutes: 3,
    relatedEntityType: "document_signature",
    relatedEntityId: deedSig,
    dueDate: date(4),
  });
  task("maple", M, "Confirm seller payoff figures with the existing lender", { actionKind: "generic", assigneeParticipantId: mp.escrow.id, priority: "high", dueDate: date(3), milestoneKey: "funds_received" });
  task("maple", M, "Prepare the recording package for the county clerk", { actionKind: "generic", assigneeParticipantId: mp.title.id, priority: "normal", dueDate: date(5), milestoneKey: "recording_submitted" });
  for (const [title, assignee, kind] of [
    ["Verify your identity", mp.buyer, "verify_identity"],
    ["Verify your identity ", mp.seller, "verify_identity"],
    ["Connect the bank account you'll pay from", mp.buyer, "connect_bank"],
    ["Tell us where your funds come from", mp.buyer, "declare_source_of_funds"],
    ["Upload the accepted purchase agreement", mp.coordinator, "upload_document"],
    ["Book the home inspection", mp.buyerAgent, "book_inspection"],
  ] as const) {
    task("maple", M, title, { actionKind: kind, assigneeParticipantId: assignee.id, status: "complete", completedAt: day(-24), completedBy: assignee.userId });
  }

  // Money: mortgage, escrow, verified instructions, settled deposit, connected bank
  add("mortgages", {
    id: did("mortgage:maple"),
    transactionId: M,
    lenderName: "Harbor Lending (Demo)",
    loanOfficerParticipantId: mp.loan!.id,
    loanAmount: 60_000_000,
    currency: "USD",
    interestRateBps: 612,
    termMonths: 360,
    loanType: "30-year fixed",
    ltvBps: 7273,
    status: "clear_to_close",
    appraisalStatus: "completed",
    underwritingStatus: "approved",
    clearToCloseAt: day(-3),
    fundedAt: null,
    provider: "manual_mortgage",
    externalReference: "HL-DEMO-55120",
    ...base(-28),
  });
  for (const c of ["Verification of employment", "Two most recent bank statements", "Homeowner's insurance binder"]) {
    add("mortgage_conditions", { id: did(`mc:maple:${c}`), mortgageId: did("mortgage:maple"), transactionId: M, description: c, satisfied: true, satisfiedAt: day(-5), ...base(-14) });
  }
  add("title_cases", { id: did("title:maple"), transactionId: M, titleCompany: "Maple Title & Escrow (Demo)", status: "clear", currentOwner: "Daniel Brooks", searchCompletedAt: day(-18), clearedAt: day(-6), insurancePolicyNumber: null, provider: "manual_title", externalReference: "MTE-DEMO-7781", ...base(-20) });
  add("title_issues", { id: did("ti:maple:hoa"), titleCaseId: did("title:maple"), transactionId: M, kind: "lien", description: "Released HOA assessment lien (2019) — release recorded", amount: 42_000, resolved: true, resolvedAt: day(-6), ...base(-17) });
  add("recordings", { id: did("rec:maple"), transactionId: M, status: "not_ready", registry: "Travis County Clerk — Real Property Records", recordingReference: null, submittedAt: null, submittedBy: null, recordedAt: null, confirmationSource: null, confirmedBy: null, documentId: null, ...base(-32) });

  const escrowId = did("escrow:maple");
  add("escrow_accounts", { id: escrowId, transactionId: M, provider: "mock_escrow", providerName: "Maple Title & Escrow (Demo)", externalReference: "ESC-SC-DEMO-MAPLE", status: "awaiting_deposit", requiredAmount: 22_500_000, receivedAmount: 2_500_000, currency: "USD", expectedReleaseDate: date(6), ...base(-27) });
  add("escrow_conditions", { id: did("ec:maple:payoff"), escrowAccountId: escrowId, transactionId: M, description: "Seller's existing mortgage payoff statement received", satisfied: true, satisfiedAt: day(-4), satisfiedBy: u("marcus.lee"), ...base(-20) });
  add("escrow_conditions", { id: did("ec:maple:insurance"), escrowAccountId: escrowId, transactionId: M, description: "Buyer's homeowner's insurance in force from closing", satisfied: true, satisfiedAt: day(-7), satisfiedBy: u("marcus.lee"), ...base(-20) });
  const instructionId = did("ins:maple:v1");
  add("bank_instructions", {
    id: instructionId,
    transactionId: M,
    purpose: "closing_funds_to_escrow",
    beneficiaryName: "Maple Title & Escrow (Demo) — Trust Account",
    bankName: "Sandbox National Bank",
    accountMask: "6789",
    routingIdentifier: "021000021",
    encryptedAccountNumber: encryptField("000123456789", keyRing, `bank_instruction:${M}:closing_funds_to_escrow`),
    currency: "USD",
    status: "verified",
    version: 1,
    previousVersionId: null,
    verifiedBy: u("priya.shah"),
    verifiedAt: day(-26),
    verificationMethod: "out_of_band_call",
    effectiveAfter: null,
    createdBy: u("marcus.lee"),
    createdAt: day(-27),
  });

  const connId = did("bankconn:olivia");
  const token = "access-sandbox-demo-olivia";
  add("bank_connections", { id: connId, userId: u("olivia.carter"), transactionId: M, provider: "mock_banking", institutionId: "mock_chase", institutionName: "Chase", externalConnectionId: "item_demo_olivia", status: "connected", consentCreatedAt: day(-25), consentExpiresAt: day(65), lastSyncedAt: day(-1), lastError: null, ...base(-25) });
  add("bank_connection_secrets", { id: did("bankconnsecret:olivia"), connectionId: connId, encryptedAccessToken: encryptField(token, keyRing, `bank_connection:${connId}`), keyVersion: 1, createdAt: day(-25) });
  const checking = add("bank_accounts", { id: did("acct:olivia:chk"), connectionId: connId, userId: u("olivia.carter"), externalAccountId: "item_demo_olivia_chk", name: "Everyday Checking", mask: "4821", currency: "USD", availableBalance: 4_280_000, currentBalance: 4_280_000, balanceAsOf: day(-1), ownerNames: ["Olivia Carter"], ownershipVerified: true, ownershipVerifiedAt: day(-25), ...base(-25) });
  add("bank_accounts", { id: did("acct:olivia:sav"), connectionId: connId, userId: u("olivia.carter"), externalAccountId: "item_demo_olivia_sav", name: "High-Yield Savings", mask: "1937", currency: "USD", availableBalance: 21_450_000, currentBalance: 21_450_000, balanceAsOf: day(-1), ownerNames: ["Olivia Carter"], ownershipVerified: true, ownershipVerifiedAt: day(-25), ...base(-25) });

  const depositId = did("pay:maple:earnest");
  add("payments", {
    id: depositId,
    transactionId: M,
    type: "earnest_money",
    rail: "wire",
    status: "settled",
    amount: 2_500_000,
    currency: "USD",
    fromAccountId: checking.id,
    bankInstructionId: instructionId,
    provider: "mock_payments",
    externalPaymentId: "pay_demo_earnest",
    idempotencyKey: "demo-earnest-maple",
    initiatedBy: u("olivia.carter"),
    approvedBy: u("marcus.lee"),
    requiresDualApproval: true,
    settledAt: day(-25),
    failureReason: null,
    ...base(-26),
  });
  for (const [i, st] of (["authorization_required", "authorized", "initiated", "received", "settled"] as const).entries()) {
    add("payment_events", { id: did(`payev:maple:${st}`), paymentId: depositId, transactionId: M, status: st, source: i < 2 ? "user" : "provider_webhook", webhookEventId: null, occurredAt: day(-26 + (i >= 3 ? 1 : 0), 10 + i) });
  }
  add("escrow_transactions", { id: did("escl:maple:earnest"), escrowAccountId: escrowId, transactionId: M, direction: "deposit", amount: 2_500_000, currency: "USD", status: "settled", paymentId: depositId, description: "Earnest money deposit", externalReference: "pay_demo_earnest", occurredAt: day(-25), createdAt: day(-26) });

  const sofCase = add("compliance_cases", { id: did("cc:maple:sof"), transactionId: M, organizationId: orgs.realty.id, participantId: mp.buyer.id, category: "source_of_funds", reason: "Declared salary savings", provider: null, status: "approved", riskFlags: [], reviewerId: u("marcus.lee"), notes: "Twelve months of statements reviewed; consistent with declared savings.", decision: "approved", decidedAt: day(-20), ...base(-24) });
  add("source_of_funds_declarations", { id: did("sof:maple"), transactionId: M, participantId: mp.buyer.id, sourceType: "salary_savings", amount: 22_500_000, currency: "USD", description: "Savings from salary over the last six years.", evidenceDocumentId: null, status: "approved", complianceCaseId: sofCase.id, ...base(-24) });

  add("calendar_events", { id: did("cal:maple:walkthrough"), transactionId: M, kind: "inspection", title: "Final walkthrough", startsAt: day(5, 16), endsAt: day(5, 17), location: "1234 Maple Ridge Drive", createdBy: u("jessica.morgan"), ...base(-3) });
  add("calendar_events", { id: did("cal:maple:closing"), transactionId: M, kind: "closing", title: "Closing appointment with notary", startsAt: day(6, 19), endsAt: day(6, 20), location: "Maple Title & Escrow (Demo) — conference room B", createdBy: u("marcus.lee"), ...base(-3) });

  const history: Array<[Row<"transaction_events">["fromState"], Row<"transaction_events">["toState"], number, string, string | null]> = [
    [null, "draft", -32, "Transaction created.", u("sofia.alvarez")],
    ["draft", "invited", -31, "Olivia Carter invited as buyer.", u("sofia.alvarez")],
    ["invited", "identity_pending", -31, "Parties invited; verifying identities.", null],
    ["identity_pending", "documents_pending", -24, "Automatic: every requirement for \"documents_pending\" is met.", null],
    ["documents_pending", "financing_pending", -24, "Automatic: every requirement for \"financing_pending\" is met.", null],
    ["financing_pending", "conditions_pending", -12, "Automatic: every requirement for \"conditions_pending\" is met.", null],
    ["conditions_pending", "ready_for_signing", -2, "Rule ready_for_signing: title clear, Clear to Close issued, closing statement approved.", null],
    ["ready_for_signing", "signing", -1, "Closing Disclosure sent for signature.", u("marcus.lee")],
  ];
  for (const [from, to, off, reason, actor] of history) event(M, from, to, off, reason, actor);

  sysMsg("maple", M, "Olivia Carter's identity is verified.", -24);
  sysMsg("maple", M, "Hi Olivia — welcome! I'll keep everything moving on our side. Ask me anything here.", -30, "jessica.morgan");
  sysMsg("maple", M, "Title is clear. The 2019 HOA lien was released and the release is recorded.", -6, "priya.shah");
  sysMsg("maple", M, "Harbor Lending (Demo): loan is clear to close.", -3);
  sysMsg("maple", M, "Great news — Clear to Close is issued. Closing Disclosure is coming your way shortly.", -3, "michael.reed");
  sysMsg("maple", M, "Title is clear, the lender has issued Clear to Close and the closing statement is approved. Ready for signing.", -2);
  sysMsg("maple", M, "Closing Disclosure v1 was sent for signature to Olivia Carter.", -1);
  sysMsg("maple", M, "Olivia, the Closing Disclosure is ready. Please look over the cash-to-close figure; call me before wiring anything — use the number on our website, not one from an email.", -1, "marcus.lee");

  // ------------------------------------------------------------------ 2. 88 Barton Creek Boulevard — title issue (blocked)
  const barton = txBase({ key: "barton", address: "88 Barton Creek Boulevard", city: "Austin", postal: "78735", price: 119_000_000, loan: 89_000_000, closingOffset: 18, openedOffset: -21, state: "conditions_pending", buyer: { name: "Noah Kim" }, seller: { name: "Grace Patel" }, image: "/images/homes/barton-creek.jpg", beds: 5, baths: 4, area: 3410, year: 2009 });
  const B = barton.id;
  verifyId("barton", B, barton.parts.buyer);
  verifyId("barton", B, barton.parts.seller);
  doc("barton", B, "Purchase Agreement", "purchase_agreement", { signedVersion: true, offset: -20 });
  doc("barton", B, "Seller's Disclosure Notice", "disclosure", { offset: -19 });
  doc("barton", B, "Title Commitment", "title", { offset: -9, uploadedBy: u("priya.shah") });
  add("mortgages", { id: did("mortgage:barton"), transactionId: B, lenderName: "Harbor Lending (Demo)", loanOfficerParticipantId: barton.parts.loan!.id, loanAmount: 89_000_000, currency: "USD", interestRateBps: 598, termMonths: 360, loanType: "30-year fixed", ltvBps: 7479, status: "conditional_approval", appraisalStatus: "completed", underwritingStatus: "conditions", clearToCloseAt: null, fundedAt: null, provider: "manual_mortgage", externalReference: "HL-DEMO-55301", ...base(-19) });
  add("mortgage_conditions", { id: did("mc:barton:1"), mortgageId: did("mortgage:barton"), transactionId: B, description: "Letter explaining a large deposit in March", satisfied: false, satisfiedAt: null, ...base(-5) });
  add("title_cases", { id: did("title:barton"), transactionId: B, titleCompany: "Maple Title & Escrow (Demo)", status: "issues_found", currentOwner: "Grace Patel", searchCompletedAt: day(-9), clearedAt: null, insurancePolicyNumber: null, provider: "manual_title", externalReference: "MTE-DEMO-7802", ...base(-12) });
  add("title_issues", { id: did("ti:barton:lien"), titleCaseId: did("title:barton"), transactionId: B, kind: "lien", description: "Unreleased contractor's lien from a 2023 pool installation", amount: 1_860_000, resolved: false, resolvedAt: null, ...base(-9) });
  add("recordings", { id: did("rec:barton"), transactionId: B, status: "not_ready", registry: "Travis County Clerk — Real Property Records", recordingReference: null, submittedAt: null, submittedBy: null, recordedAt: null, confirmationSource: null, confirmedBy: null, documentId: null, ...base(-21) });
  task("barton", B, "Obtain lien release from pool contractor", { actionKind: "generic", assigneeParticipantId: barton.parts.title.id, priority: "urgent", dueDate: date(4), milestoneKey: "title_cleared", status: "blocked" });
  task("barton", B, "Explain the March deposit to the lender", { actionKind: "generic", assigneeParticipantId: barton.parts.buyer.id, priority: "high", dueDate: date(2), milestoneKey: "financing_approved" });
  event(B, null, "draft", -21, "Transaction created.", u("sofia.alvarez"));
  event(B, "financing_pending", "conditions_pending", -4, "Automatic: financing approved.", null);
  sysMsg("barton", B, "Title issue found (lien): Unreleased contractor's lien from a 2023 pool installation", -9);

  // ------------------------------------------------------------------ 3. 509 Lakeview Terrace — identity review
  const lake = txBase({ key: "lakeview", address: "509 Lakeview Terrace", city: "Round Rock", postal: "78664", price: 54_900_000, loan: 43_900_000, closingOffset: 29, openedOffset: -6, state: "identity_pending", buyer: { name: "Ava Thompson" }, seller: { name: "Liam Chen" }, image: "/images/homes/lakeview.jpg", beds: 3, baths: 2, area: 1980, year: 1998 });
  const L = lake.id;
  verifyId("lakeview", L, lake.parts.buyer, "review_required");
  doc("lakeview", L, "Purchase Agreement", "purchase_agreement", { signedVersion: true, offset: -6 });
  add("compliance_cases", { id: did("cc:lakeview:pep"), transactionId: L, organizationId: orgs.realty.id, participantId: lake.parts.buyer.id, category: "pep", reason: "A possible politically-exposed-person match needs manual review.", provider: "mock_identity", status: "review_required", riskFlags: ["pep", "liveness"], reviewerId: null, notes: null, decision: null, decidedAt: null, ...base(-4) });
  add("mortgages", { id: did("mortgage:lakeview"), transactionId: L, lenderName: "Harbor Lending (Demo)", loanOfficerParticipantId: lake.parts.loan!.id, loanAmount: 43_900_000, currency: "USD", interestRateBps: 605, termMonths: 360, loanType: "30-year fixed", ltvBps: 7996, status: "application", appraisalStatus: "ordered", underwritingStatus: "not_started", clearToCloseAt: null, fundedAt: null, provider: "manual_mortgage", externalReference: null, ...base(-5) });
  add("title_cases", { id: did("title:lakeview"), transactionId: L, titleCompany: "Maple Title & Escrow (Demo)", status: "searching", currentOwner: null, searchCompletedAt: null, clearedAt: null, insurancePolicyNumber: null, provider: "manual_title", externalReference: null, ...base(-5) });
  add("recordings", { id: did("rec:lakeview"), transactionId: L, status: "not_ready", registry: "Williamson County Clerk — Official Public Records", recordingReference: null, submittedAt: null, submittedBy: null, recordedAt: null, confirmationSource: null, confirmedBy: null, documentId: null, ...base(-6) });
  task("lakeview", L, "Verify your identity", { actionKind: "verify_identity", assigneeParticipantId: lake.parts.seller.id, priority: "high", milestoneKey: "identity_verified", dueDate: date(-1) });
  event(L, null, "draft", -6, "Transaction created.", u("sofia.alvarez"));
  event(L, "invited", "identity_pending", -6, "Parties invited; verifying identities.", null);

  // ------------------------------------------------------------------ 4. 2201 Hillside Avenue — closed, with Home Record
  const hill = txBase({ key: "hillside", address: "2201 Hillside Avenue", city: "Austin", postal: "78704", price: 67_500_000, loan: null, closingOffset: -21, openedOffset: -70, state: "closed", buyer: { key: "mia.rodriguez", name: "Mia Rodriguez" }, seller: { name: "Robert Hayes" }, image: "/images/homes/hillside.jpg", beds: 3, baths: 2.5, area: 2104, year: 2004 });
  const H = hill.id;
  verifyId("hillside", H, hill.parts.buyer);
  verifyId("hillside", H, hill.parts.seller);
  for (const [n, c] of [["Purchase Agreement", "purchase_agreement"], ["Closing Disclosure", "closing_statement"], ["General Warranty Deed", "deed"]] as const) {
    doc("hillside", H, n, c, { signedVersion: true, offset: -24 });
  }
  doc("hillside", H, "Owner's Title Insurance Policy", "title", { offset: -20, uploadedBy: u("priya.shah") });
  add("title_cases", { id: did("title:hillside"), transactionId: H, titleCompany: "Maple Title & Escrow (Demo)", status: "insured", currentOwner: "Mia Rodriguez", searchCompletedAt: day(-50), clearedAt: day(-35), insurancePolicyNumber: "OTP-DEMO-11873", provider: "manual_title", externalReference: "MTE-DEMO-7621", ...base(-60) });
  add("escrow_accounts", { id: did("escrow:hillside"), transactionId: H, provider: "mock_escrow", providerName: "Maple Title & Escrow (Demo)", externalReference: "ESC-SC-DEMO-HILLSIDE", status: "disbursed", requiredAmount: 67_500_000, receivedAmount: 67_500_000, currency: "USD", expectedReleaseDate: date(-21), ...base(-60) });
  const recId = did("rec:hillside");
  add("recordings", { id: recId, transactionId: H, status: "recorded", registry: "Travis County Clerk — Real Property Records", recordingReference: "DEMO-2026-018842", submittedAt: day(-21, 16), submittedBy: u("priya.shah"), recordedAt: day(-20, 18), confirmationSource: "authorized_professional", confirmedBy: u("priya.shah"), documentId: did("doc:hillside:General Warranty Deed"), ...base(-70) });
  const record = add("ownership_records", { id: did("own:hillside"), transactionId: H, propertyId: hill.propertyId, ownerUserIds: [u("mia.rodriguez")], ownerNames: ["Mia Rodriguez"], purchaseDate: date(-20), purchaseAmount: 67_500_000, currency: "USD", recordingId: recId, ...base(-20) });
  for (const [kind, title, amount, off, docName] of [
    ["signed_document", "Purchase Agreement (signed)", null, -24, "Purchase Agreement"],
    ["signed_document", "Closing Disclosure (signed)", null, -21, "Closing Disclosure"],
    ["signed_document", "General Warranty Deed (signed)", null, -21, "General Warranty Deed"],
    ["insurance", "Owner's title insurance policy OTP-DEMO-11873", null, -20, "Owner's Title Insurance Policy"],
    ["warranty", "Home warranty — 12 months (demo)", 54_000, -20, null],
    ["renovation", "Replaced kitchen faucet and garbage disposal", 38_500, -6, null],
  ] as const) {
    add("ownership_record_items", { id: did(`ori:hillside:${title}`), ownershipRecordId: record.id, kind, title, amount, occurredOn: date(off), documentId: docName ? did(`doc:hillside:${docName}`) : null, createdBy: kind === "renovation" ? u("mia.rodriguez") : null, createdAt: day(off) });
  }
  event(H, "recording_pending", "ownership_transfer", -20, "Automatic: every requirement for \"ownership_transfer\" is met.", null);
  event(H, "ownership_transfer", "closed", -19, "Disbursement confirmed; file closed.", u("marcus.lee"));

  // ------------------------------------------------------------------ 6. Property Autopilot — Alex Morgan's portfolio (fictional)
  // Monitoring only: Sagolik never pays these bills. Every number here is invented.
  {
    const alex = u("alex.morgan");
    const orgId = DEMO_PORTFOLIO_ORG_ID;
    add("organizations", { id: orgId, name: "Morgan Family Holdings LLC (Demo)", slug: "morgan-family-holdings-demo", type: "holding_entity", jurisdiction: "US", ...base(-400) });
    add("organization_members", { id: did("mem:holdings:alex"), organizationId: orgId, userId: alex, role: "organization_admin", ...base(-400) });

    const connId = did("bankconn:alex");
    add("bank_connections", { id: connId, userId: alex, transactionId: null, provider: "mock_banking", institutionId: "mock_chase", institutionName: "First Coastal Bank (Demo)", externalConnectionId: "item_demo_alex", status: "connected", consentCreatedAt: day(-120), consentExpiresAt: day(245), lastSyncedAt: day(-1, 23), lastError: null, ...base(-120) });
    const acct = (key: string, name: string, mask: string, available: number) =>
      add("bank_accounts", { id: did(`acct:alex:${key}`), connectionId: connId, userId: alex, externalAccountId: `item_demo_alex_${key}`, name, mask, currency: "USD", availableBalance: available, currentBalance: available, balanceAsOf: day(-1, 23), ownerNames: ["Alex Morgan"], ownershipVerified: true, ownershipVerifiedAt: day(-120), ...base(-120) });
    const operating = acct("operating", "Holdings Operating", "8291", 4_820_000);
    const austinOps = acct("austin", "Austin Rentals Operating", "4410", 980_000);
    const austin2Ops = acct("austin2", "Austin #2 Operating", "5520", 210_000);
    const reserve = acct("reserve", "Property Reserve", "7002", 10_000_000);

    const policies = defaultReviewPolicies().map((p) => add("review_policies", { id: did(`policy:holdings:${p.position}`), organizationId: orgId, passportId: null, ...p, enabled: true, ...base(-400) }));

    const vendorIds = new Map<string, string>();
    const vendor = (name: string, category: Row<"vendors">["category"]) => {
      if (!vendorIds.has(name)) vendorIds.set(name, add("vendors", { id: did(`vendor:holdings:${name}`), organizationId: orgId, name, category, phone: null, website: null, ...base(-400) }).id);
      return vendorIds.get(name)!;
    };

    type Spec = { key: keyof typeof DEMO_PASSPORTS; label: string; address: string; city: string; region: string; postal: string; type: string; acquired: number; tax: number; hoa: number | null };
    const specs: Spec[] = [
      { key: "miami", label: "Miami Beach Residence", address: "412 Coral Shell Way", city: "Miami Beach", region: "FL", postal: "33139", type: "single_family", acquired: -900, tax: 1_840_000, hoa: null },
      { key: "manhattan", label: "Manhattan Condo", address: "88 Harborview Place, Apt 12B", city: "New York", region: "NY", postal: "10014", type: "condo", acquired: -1400, tax: 3_860_000, hoa: 185_000 },
      { key: "austin1", label: "Austin Rental #1", address: "1507 Bluebonnet Lane", city: "Austin", region: "TX", postal: "78745", type: "single_family", acquired: -700, tax: 710_000, hoa: 8_500 },
      { key: "austin2", label: "Austin Rental #2", address: "2210 Cedar Hollow Road", city: "Austin", region: "TX", postal: "78748", type: "single_family", acquired: -300, tax: 760_000, hoa: null },
      { key: "aspen", label: "Aspen Vacation Home", address: "37 Silver Pine Way", city: "Aspen", region: "CO", postal: "81611", type: "single_family", acquired: -2000, tax: 2_230_000, hoa: null },
    ];
    for (const sp of specs) {
      const propertyId = did(`prop:autopilot:${sp.key}`);
      add("properties", { id: propertyId, organizationId: orgId, addressLine1: sp.address, addressLine2: null, city: sp.city, region: sp.region, postalCode: sp.postal, country: "US", latitude: null, longitude: null, parcelId: null, propertyType: sp.type, yearBuilt: null, livingArea: null, areaUnit: "sqft", bedrooms: null, bathrooms: null, lotSize: null, imageUrls: [], propertyTaxAnnual: sp.tax, hoaMonthly: sp.hoa, energyRating: null, legalDescription: null, currency: "USD", ...base(sp.acquired) });
      add("property_passports", { id: DEMO_PASSPORTS[sp.key], organizationId: orgId, propertyId, ownershipRecordId: null, origin: "imported", label: sp.label, status: "live", monitoring: "monitor", acquiredOn: date(sp.acquired), activatedAt: day(-90), ...base(-90) });
    }
    const fund = (key: keyof typeof DEMO_PASSPORTS, op: string, min: number, reserveId: string | null) =>
      add("funding_rules", { id: did(`funding:${key}`), organizationId: orgId, passportId: DEMO_PASSPORTS[key], operatingAccountId: op, reserveAccountId: reserveId, minOperatingBalance: min, targetOperatingBalance: min * 4, ...base(-90) });
    fund("miami", operating.id, 500_000, reserve.id);
    fund("manhattan", operating.id, 500_000, reserve.id);
    fund("aspen", operating.id, 500_000, reserve.id);
    fund("austin1", austinOps.id, 100_000, reserve.id);
    fund("austin2", austin2Ops.id, 50_000, reserve.id);

    const obligations: Obligation[] = [];
    type ObSpec = Partial<Obligation> & Pick<Obligation, "kind" | "label" | "amountType" | "frequency"> & { vendor?: [string, Row<"vendors">["category"]] };
    const ob = (key: keyof typeof DEMO_PASSPORTS, slug: string, o: ObSpec): Obligation => {
      const { vendor: v, ...rest } = o;
      const row = add("obligations", {
        id: did(`ob:${key}:${slug}`),
        organizationId: orgId,
        passportId: DEMO_PASSPORTS[key],
        vendorId: v ? vendor(v[0], v[1]) : null,
        priority: "critical",
        expectedAmount: null,
        expectedMin: null,
        expectedMax: null,
        currency: "USD",
        nextDueOn: null,
        graceDays: 0,
        payMethod: "autopay",
        escrowStatus: "not_applicable",
        fundingAccountId: null,
        referenceLast4: null,
        payeeMatch: null,
        source: "demo",
        confidence: 100,
        status: "active",
        endedOn: null,
        createdBy: alex,
        ...base(-90),
        ...rest,
      });
      obligations.push(row);
      return row;
    };
    const escrowed = { payMethod: "escrow" as const, escrowStatus: "confirmed_escrowed" as const };
    const direct = { payMethod: "manual" as const, escrowStatus: "confirmed_not_escrowed" as const };

    // Miami Beach Residence — the electricity anomaly.
    const miamiMortgage = ob("miami", "mortgage", { kind: "mortgage", label: "Mortgage", amountType: "fixed", expectedAmount: 825_000, frequency: "monthly", nextDueOn: date(14), graceDays: 15, vendor: ["Atlantic Home Loans (Demo)", "lender"] });
    ob("miami", "tax", { kind: "property_tax", label: "Property tax", amountType: "periodic", expectedAmount: 1_840_000, frequency: "annual", nextDueOn: date(200), ...direct, vendor: ["County Tax Collector (Demo)", "tax_authority"] });
    ob("miami", "insurance", { kind: "insurance", label: "Homeowners insurance", amountType: "periodic", expectedAmount: 1_260_000, frequency: "annual", nextDueOn: date(150), ...direct, vendor: ["Harborline Mutual (Demo)", "insurer"] });
    const miamiPower = ob("miami", "electricity", { kind: "electricity", label: "Electricity", amountType: "variable", expectedMin: 22_000, expectedMax: 31_000, frequency: "monthly", nextDueOn: date(9), vendor: ["Coastal Power & Light (Demo)", "utility"] });
    ob("miami", "water", { kind: "water", label: "Water", amountType: "variable", expectedMin: 11_000, expectedMax: 16_000, expectedAmount: 14_000, frequency: "monthly", nextDueOn: date(18), vendor: ["Bayshore Water (Demo)", "utility"] });
    ob("miami", "internet", { kind: "internet", label: "Internet", priority: "important", amountType: "fixed", expectedAmount: 8_900, frequency: "monthly", nextDueOn: date(21), vendor: ["Bayline Fiber (Demo)", "telecom"] });
    ob("miami", "security", { kind: "security", label: "Security monitoring", priority: "important", amountType: "fixed", expectedAmount: 6_500, frequency: "monthly", nextDueOn: date(5), vendor: ["Sentinel Home Security (Demo)", "security"] });

    // Manhattan Condo — taxes and insurance paid through the lender's escrow.
    const nycMortgage = ob("manhattan", "mortgage", { kind: "mortgage", label: "Mortgage (includes escrow)", amountType: "fixed", expectedAmount: 690_000, frequency: "monthly", nextDueOn: date(14), graceDays: 15, vendor: ["Empire Mutual Servicing (Demo)", "lender"] });
    const nycTax = ob("manhattan", "tax", { kind: "property_tax", label: "Property tax", amountType: "periodic", expectedAmount: 965_000, frequency: "quarterly", nextDueOn: date(20), ...escrowed, vendor: ["City Department of Finance (Demo)", "tax_authority"] });
    ob("manhattan", "insurance", { kind: "insurance", label: "Condo insurance (HO-6)", amountType: "periodic", expectedAmount: 180_000, frequency: "annual", nextDueOn: date(240), ...escrowed, vendor: ["Harborline Mutual (Demo)", "insurer"] });
    const nycHoa = ob("manhattan", "hoa", { kind: "hoa", label: "Common charges", amountType: "fixed", expectedAmount: 185_000, frequency: "monthly", nextDueOn: date(6), vendor: ["Harborview Condominium Board (Demo)", "hoa"] });
    ob("manhattan", "electricity", { kind: "electricity", label: "Electricity", amountType: "variable", expectedMin: 14_000, expectedMax: 19_000, expectedAmount: 16_000, frequency: "monthly", nextDueOn: date(16), vendor: ["Hudson Electric (Demo)", "utility"] });

    // Austin Rental #1 — everything in order.
    const a1Mortgage = ob("austin1", "mortgage", { kind: "mortgage", label: "Mortgage (includes escrow)", amountType: "fixed", expectedAmount: 265_000, frequency: "monthly", nextDueOn: date(14), graceDays: 15, vendor: ["Lone Star Home Lending (Demo)", "lender"] });
    ob("austin1", "tax", { kind: "property_tax", label: "Property tax", amountType: "periodic", expectedAmount: 710_000, frequency: "annual", nextDueOn: date(120), ...escrowed, vendor: ["County Tax Office (Demo)", "tax_authority"] });
    ob("austin1", "insurance", { kind: "insurance", label: "Landlord insurance", amountType: "periodic", expectedAmount: 210_000, frequency: "annual", nextDueOn: date(170), ...escrowed, vendor: ["Prairie Shield Insurance (Demo)", "insurer"] });
    ob("austin1", "hoa", { kind: "hoa", label: "HOA dues", amountType: "fixed", expectedAmount: 8_500, frequency: "monthly", nextDueOn: date(10), vendor: ["Bluebonnet Commons HOA (Demo)", "hoa"] });
    ob("austin1", "water", { kind: "water", label: "Water", amountType: "variable", expectedMin: 9_000, expectedMax: 13_000, expectedAmount: 11_000, frequency: "monthly", nextDueOn: date(19), vendor: ["City Water Utility (Demo)", "utility"] });

    // Austin Rental #2 — vacant between tenants; its account is running low.
    ob("austin2", "mortgage", { kind: "mortgage", label: "Mortgage (includes escrow)", amountType: "fixed", expectedAmount: 298_000, frequency: "monthly", nextDueOn: date(22), graceDays: 15, vendor: ["Lone Star Home Lending (Demo)", "lender"] });
    ob("austin2", "tax", { kind: "property_tax", label: "Property tax", amountType: "periodic", expectedAmount: 760_000, frequency: "annual", nextDueOn: date(120), ...escrowed, vendor: ["County Tax Office (Demo)", "tax_authority"] });
    ob("austin2", "insurance", { kind: "insurance", label: "Landlord insurance", amountType: "periodic", expectedAmount: 225_000, frequency: "annual", nextDueOn: date(95), ...escrowed, vendor: ["Prairie Shield Insurance (Demo)", "insurer"] });
    ob("austin2", "electricity", { kind: "electricity", label: "Electricity (vacant unit)", amountType: "variable", expectedMin: 30_000, expectedMax: 46_000, expectedAmount: 38_000, frequency: "monthly", nextDueOn: date(11), vendor: ["Hill Country Electric (Demo)", "utility"] });

    // Aspen Vacation Home — owned outright; the insurance renewal needs Alex's review.
    ob("aspen", "tax", { kind: "property_tax", label: "Property tax", amountType: "periodic", expectedAmount: 1_115_000, frequency: "semiannual", nextDueOn: date(60), ...direct, vendor: ["County Treasurer (Demo)", "tax_authority"] });
    const aspenIns = ob("aspen", "insurance", { kind: "insurance", label: "Homeowners insurance", amountType: "event", frequency: "annual", nextDueOn: date(24), ...direct, vendor: ["Summit Peak Insurance (Demo)", "insurer"] });
    ob("aspen", "electricity", { kind: "electricity", label: "Electricity", amountType: "variable", expectedMin: 21_000, expectedMax: 29_000, expectedAmount: 25_000, frequency: "monthly", nextDueOn: date(13), vendor: ["Roaring Fork Power (Demo)", "utility"] });
    ob("aspen", "gas", { kind: "gas", label: "Gas", amountType: "variable", expectedMin: 18_000, expectedMax: 34_000, expectedAmount: 26_000, frequency: "monthly", nextDueOn: date(15), vendor: ["Mountain Gas (Demo)", "utility"] });
    ob("aspen", "snow", { kind: "maintenance", label: "Snow removal", priority: "important", amountType: "fixed", expectedAmount: 45_000, frequency: "monthly", nextDueOn: date(8), payMethod: "bank_bill_pay", vendor: ["High Country Services (Demo)", "maintenance"] });

    // Bills. History is "paid (verified)" from the fictional bank statement.
    const bills: Bill[] = [];
    const billRow = (o: Obligation, key: string, amount: number, dueOn: string, p: Partial<Bill> = {}) => {
      // Bills arrive before they're due: history on its due date, current ones two days ago.
      const created = dueOn < date(0) ? `${dueOn}T09:00:00.000Z` : day(-2);
      const row = add("bills", {
        id: did(`bill:${o.id}:${key}`),
        organizationId: orgId,
        passportId: o.passportId,
        obligationId: o.id,
        amount,
        currency: "USD",
        dueOn,
        periodLabel: null,
        status: "received",
        source: "demo",
        fileKey: null,
        fileName: null,
        paidOn: null,
        paymentReference: null,
        verifiedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        secondReviewedBy: null,
        secondReviewedAt: null,
        createdBy: alex,
        createdAt: created,
        updatedAt: created,
        ...p,
      });
      bills.push(row);
      return row;
    };
    const paidRow = (o: Obligation, monthsAgo: number, amount: number) => {
      const dueOn = addMonths(o.nextDueOn!, -monthsAgo);
      return billRow(o, `m${monthsAgo}`, amount, dueOn, { status: "paid_verified", paidOn: dueOn, verifiedAt: `${dueOn}T18:00:00.000Z`, paymentReference: "Matched on the demo bank statement", updatedAt: `${dueOn}T18:00:00.000Z` });
    };
    // Eleven months of Miami electricity between $220 and $310 (median $305), then $2,870.
    [31_000, 30_900, 30_800, 30_600, 30_500, 30_500, 28_900, 27_100, 25_600, 23_800, 22_000].forEach((amount, i) => paidRow(miamiPower, i + 1, amount));
    billRow(miamiPower, "current", 287_000, miamiPower.nextDueOn!, { periodLabel: "Last month's usage" });
    for (const m of [miamiMortgage, nycMortgage, a1Mortgage]) for (const k of [1, 2]) paidRow(m, k, m.expectedAmount!);
    for (const k of [1, 2, 3]) paidRow(nycHoa, k, 185_000);
    billRow(nycTax, "current", 965_000, nycTax.nextDueOn!, { status: "covered_by_escrow", periodLabel: "Quarterly installment" });
    // The Aspen renewal notice, with a fictional PDF.
    const renewalKey = `autopilot/${orgId}/renewal-notice-aspen.pdf`;
    files.push({ key: renewalKey, bytes: demoPdf("Homeowners policy renewal notice (DEMO)", ["Summit Peak Insurance (Demo) — fictional insurer", "Insured: Morgan Family Holdings LLC (Demo)", "Property: 37 Silver Pine Way, Aspen, CO (fictional)", "Renewal premium: $14,200.00"]), mimeType: "application/pdf" });
    billRow(aspenIns, "renewal", 1_420_000, aspenIns.nextDueOn!, { periodLabel: "Annual renewal", source: "document", fileKey: renewalKey, fileName: "renewal-notice-aspen.pdf" });

    // The decision log, from the same rules the live service uses.
    const accountsView = [operating, austinOps, austin2Ops, reserve].map((a) => ({ id: a.id, label: a.name, mask: a.mask, currency: a.currency, available: a.availableBalance, asOf: a.balanceAsOf, connectionOk: true }));
    const inputs: PassportInput[] = specs.map((sp) => ({
      passportId: DEMO_PASSPORTS[sp.key],
      label: sp.label,
      status: "live",
      monitoring: "monitor",
      currency: "USD",
      today: date(0),
      obligations: obligations.filter((o) => o.passportId === DEMO_PASSPORTS[sp.key]),
      bills: bills.filter((b) => b.passportId === DEMO_PASSPORTS[sp.key]),
      policies,
      funding: (rows.funding_rules ?? []).find((f) => f.passportId === DEMO_PASSPORTS[sp.key]) ?? null,
      accounts: accountsView,
    }));
    for (const a of assessPortfolio(inputs).assessments) {
      for (const d of a.decisions) {
        const bill = d.billId ? bills.find((b) => b.id === d.billId) : undefined;
        const at = bill?.status === "paid_verified" ? `${bill.dueOn}T18:00:00.000Z` : day(-1, 6); // history on its payment date; the rest as of yesterday
        add("autopilot_decisions", { id: did(`decision:${a.passportId}:${d.key}`), organizationId: orgId, passportId: a.passportId, obligationId: d.obligationId, billId: d.billId, outcome: d.outcome, severity: d.severity, summary: d.summary, reasons: d.reasons, rule: d.rule, amount: d.amount, currency: d.currency, evaluatedOn: at.slice(0, 10), dedupeKey: `${a.passportId}:${d.key}`, createdAt: at });
      }
    }
  }

  // ------------------------------------------------------------------ 5. Blue Harbor Coffee Roasters — business acquisition (beta), in due diligence
  {
    const K = "blueharbor";
    const X = DEMO_BUSINESS_TRANSACTION_ID;
    const premisesId = did(`prop:${K}`);
    const companyId = did(`company:${K}`);
    add("properties", {
      id: premisesId, organizationId: orgs.advisory.id, addressLine1: "410 Harbor Street", addressLine2: "Unit B", city: "Galveston", region: "TX", postalCode: "77550",
      country: "US", latitude: null, longitude: null, parcelId: null, propertyType: "business_premises", yearBuilt: null, livingArea: 5200, areaUnit: "sqft",
      bedrooms: null, bathrooms: null, lotSize: null, imageUrls: [], propertyTaxAnnual: null, hoaMonthly: null, energyRating: null,
      legalDescription: "Leased roastery and warehouse space (fictional)", currency: "USD", ...base(-40),
    });
    add("companies", {
      id: companyId, organizationId: orgs.advisory.id, legalName: "Blue Harbor Coffee Roasters, LLC", tradeName: "Blue Harbor Coffee", entityType: "llc",
      stateOfFormation: "TX", industry: "Specialty coffee roasting and wholesale",
      description: "Fictional demo company: roasts and sells specialty coffee to cafés and grocers along the Gulf Coast.",
      employeeCount: 14, annualRevenue: 180_000_000, dealStructure: "asset_purchase", website: null, currency: "USD", ...base(-40),
    });
    add("transactions", {
      id: X, organizationId: orgs.advisory.id, propertyId: premisesId, companyId, reference: "SC-DEMO-BLUEHARBOR", type: "business_acquisition",
      state: "financing_pending", jurisdiction: "US-BUSINESS", currency: "USD", salePrice: 145_000_000, expectedClosingDate: date(38),
      coordinatorId: u("rachel.kim"), createdBy: u("rachel.kim"), stateChangedAt: day(-3), closedAt: null, version: 6, ...base(-35),
    });
    const bp = (role: Row<"transaction_participants">["role"], key: string, orgId: string | null = null) =>
      add("transaction_participants", {
        id: did(`part:${K}:${role}`), transactionId: X, userId: P[key]!.userId, organizationId: orgId, role, displayName: P[key]!.name, email: P[key]!.email,
        status: "active", invitedBy: u("rachel.kim"), joinedAt: day(-34), ...base(-35),
      });
    const b = {
      broker: bp("broker", "rachel.kim", orgs.advisory.id),
      buyer: bp("buyer", "amara.okafor"),
      seller: bp("seller", "tom.becker"),
      counsel: bp("attorney", "david.chen", orgs.law.id),
      accountant: bp("accountant", "grace.liu", orgs.accounting.id),
      lender: bp("loan_officer", "michael.reed", orgs.lender.id),
      escrow: bp("escrow_officer", "marcus.lee", orgs.title.id),
    };
    const bOwners: Record<string, Row<"transaction_participants">["role"]> = {
      offer_accepted: "broker", transaction_opened: "broker", identity_verified: "buyer", documents_received: "broker", financing_approved: "loan_officer",
      inspection_completed: "accountant", title_cleared: "attorney", signing_complete: "attorney", funds_received: "buyer", recording_submitted: "attorney", ownership_transferred: "attorney",
    };
    const bDues: Record<string, number> = { documents_received: -2, financing_approved: 20, inspection_completed: 12, title_cleared: 25, signing_complete: 36, funds_received: 37, recording_submitted: 38, ownership_transferred: 38 };
    for (const [key, role] of Object.entries(bOwners)) {
      add("transaction_milestones", { id: did(`ms:${K}:${key}`), transactionId: X, key: key as Row<"transaction_milestones">["key"], ownerRole: role, dueDate: key in bDues ? date(bDues[key]!) : null, completedAt: null, ...base(-35) });
    }
    add("message_threads", { id: did(`room:${K}`), transactionId: X, kind: "transaction_room", title: "Deal room", memberUserIds: [], ...base(-35) });
    verifyId(K, X, b.buyer);
    verifyId(K, X, b.seller);
    const up = (key: string) => ({ uploadedBy: u(key) });
    doc(K, X, "Letter of Intent (signed)", "letter_of_intent", { signatureStatus: "completed", offset: -34, ...up("rachel.kim") });
    doc(K, X, "Mutual NDA", "other", { signatureStatus: "completed", offset: -36, ...up("rachel.kim") });
    doc(K, X, "Financial statements 2023–2025 (seller-provided)", "tax", { offset: -30, accessLevel: "principals_and_professionals", ...up("tom.becker") });
    doc(K, X, "Quality of Earnings report — draft", "due_diligence_report", { status: "pending_review", offset: -3, accessLevel: "principals_and_professionals", ...up("grace.liu") });
    doc(K, X, "Disclosure schedules — draft", "disclosure_schedules", { status: "pending_review", offset: -5, ...up("david.chen") });
    doc(K, X, "Asset Purchase Agreement — draft v3", "definitive_agreement", { status: "pending_review", signatureStatus: "draft", offset: -2, ...up("david.chen") });
    doc(K, X, "Roastery lease (current)", "other", { offset: -29, ...up("tom.becker") });
    add("mortgages", {
      id: did(`mortgage:${K}`), transactionId: X, lenderName: "Harbor Lending (Demo)", loanOfficerParticipantId: b.lender.id, loanAmount: 116_000_000, currency: "USD",
      interestRateBps: null, termMonths: 120, loanType: "Business acquisition term loan", ltvBps: 8000, status: "underwriting", appraisalStatus: "ordered",
      underwritingStatus: "in_review", clearToCloseAt: null, fundedAt: null, provider: "manual_mortgage", externalReference: "HL-DEMO-BIZ-2231", ...base(-20),
    });
    for (const [c, done] of [["Signed asset purchase agreement", false], ["Business valuation", false], ["Buyer's personal financial statement", true], ["Landlord consent to lease assignment", false]] as const) {
      add("mortgage_conditions", { id: did(`mc:${K}:${c}`), mortgageId: did(`mortgage:${K}`), transactionId: X, description: c, satisfied: done, satisfiedAt: done ? day(-6) : null, ...base(-18) });
    }
    add("title_cases", { id: did(`title:${K}`), transactionId: X, titleCompany: "Chen Legal (Demo) — UCC and tax lien search", status: "searching", currentOwner: "Blue Harbor Coffee Roasters, LLC", searchCompletedAt: null, clearedAt: null, insurancePolicyNumber: null, provider: "manual_title", externalReference: "CL-DEMO-LIEN-58", ...base(-4) });
    task(K, X, "Finish quality-of-earnings review", { actionKind: "review_document", milestoneKey: "inspection_completed", assigneeParticipantId: b.accountant.id, priority: "high", dueDate: date(12), createdBy: u("rachel.kim") });
    task(K, X, "Review disclosure schedules with seller", { actionKind: "review_document", milestoneKey: "documents_received", assigneeParticipantId: b.counsel.id, dueDate: date(9), createdBy: u("rachel.kim") });
    task(K, X, "Get landlord consent to assign the roastery lease", { actionKind: "generic", milestoneKey: "financing_approved", assigneeParticipantId: b.seller.id, priority: "high", dueDate: date(15), createdBy: u("rachel.kim") });
    task(K, X, "Upload personal financial statement for the lender", { actionKind: "upload_document", milestoneKey: "financing_approved", assigneeParticipantId: b.buyer.id, status: "complete", completedAt: day(-6), completedBy: u("amara.okafor"), createdBy: u("michael.reed") });
    for (const [from, to, off, reason] of [
      ["draft", "invited", -34, "Deal room opened; parties invited."],
      ["invited", "identity_pending", -33, "Automatic: every requirement for \"identity_pending\" is met."],
      ["identity_pending", "documents_pending", -25, "Automatic: every requirement for \"documents_pending\" is met."],
      ["documents_pending", "financing_pending", -3, "Diligence documents received; financing underway."],
    ] as const) event(X, from, to, off, reason, from === "draft" ? u("rachel.kim") : null);
    sysMsg(K, X, "Deal room opened by Rachel Kim. Everything for this acquisition — diligence, financing, signatures and closing — is tracked here.", -34);
    sysMsg(K, X, "Grace Liu uploaded a draft Quality of Earnings report for review.", -3);
    add("notifications", { id: did("n:amara:qoe"), userId: u("amara.okafor"), transactionId: X, kind: "status_update", title: "Due diligence update", body: "A draft Quality of Earnings report is ready for review by your advisors.", linkPath: `/app/transactions/${X}/documents`, channel: "in_app", readAt: null, sentAt: day(-3), createdAt: day(-3) });
  }

  // ------------------------------------------------------------------ notifications for the buyer
  add("notifications", { id: did("n:olivia:cd"), userId: u("olivia.carter"), transactionId: M, kind: "signature_requested", title: "Closing Disclosure is ready for your signature", body: "Please review and sign the Closing Disclosure. It takes about three minutes.", linkPath: `/app/transactions/${M}/documents`, channel: "in_app", readAt: null, sentAt: day(-1), createdAt: day(-1) });
  add("notifications", { id: did("n:olivia:ctc"), userId: u("olivia.carter"), transactionId: M, kind: "status_update", title: "Update on 1234 Maple Ridge Drive", body: "Your closing documents are being prepared for signing.", linkPath: `/app/transactions/${M}`, channel: "in_app", readAt: day(-2), sentAt: day(-2), createdAt: day(-2) });

  // ------------------------------------------------------------------ baseline audit trail
  const auditRow = (txId: string, actorKey: string | null, action: string, resourceType: string, resourceId: string | null, offset: number, metadata: Record<string, unknown> = {}) =>
    add("audit_events", {
      id: did(`audit:${txId}:${action}:${resourceId}:${offset}`),
      organizationId: orgs.realty.id,
      transactionId: txId,
      actorId: actorKey ? u(actorKey) : null,
      actorType: actorKey ? "user" : "system",
      action,
      resourceType,
      resourceId,
      occurredAt: day(offset),
      ipAddress: null,
      userAgent: null,
      metadata: { ...metadata, demo: true },
      correlationId: `corr_demo_${action}`,
    });
  auditRow(M, "sofia.alvarez", "transaction.created", "transaction", M, -32, { reference: "SC-DEMO-MAPLE" });
  auditRow(M, "marcus.lee", "bank_instruction.created", "bank_instruction", instructionId, -27, { version: 1, mask: "6789" });
  auditRow(M, "priya.shah", "bank_instruction.verified", "bank_instruction", instructionId, -26, { method: "out_of_band_call" });
  auditRow(M, "olivia.carter", "bank.connected", "bank_connection", connId, -25, { institution: "Chase" });
  auditRow(M, null, "payment.settled", "payment", depositId, -25, { amount: 2_500_000, currency: "USD" });
  auditRow(M, "marcus.lee", "compliance.decided", "compliance_case", sofCase.id, -20, { decision: "approved", decidedBy: "human" });
  auditRow(M, "michael.reed", "mortgage.status_changed", "mortgage", did("mortgage:maple"), -3, { to: "clear_to_close" });
  auditRow(M, "marcus.lee", "signature.requested", "document", cd.id, -1, { signers: [mp.buyer.id] });
  auditRow(M, "priya.shah", "signature.requested", "document", deed.id, -1, { signers: [mp.seller.id] });

  return { rows, files };
}

/** Insert order respects foreign keys. */
export const SEED_ORDER: TableName[] = [
  "profiles",
  "organizations",
  "organization_members",
  "organization_settings",
  "organization_branding",
  "plans",
  "properties",
  "companies",
  "transactions",
  "transaction_participants",
  "transaction_milestones",
  "transaction_requirements",
  "transaction_events",
  "tasks",
  "task_dependencies",
  "documents",
  "document_versions",
  "document_signatures",
  "identity_verifications",
  "compliance_cases",
  "source_of_funds_declarations",
  "bank_connections",
  "bank_connection_secrets",
  "bank_accounts",
  "bank_instructions",
  "payments",
  "payment_events",
  "escrow_accounts",
  "escrow_transactions",
  "escrow_conditions",
  "approvals",
  "mortgages",
  "mortgage_conditions",
  "title_cases",
  "title_issues",
  "recordings",
  "ownership_records",
  "ownership_record_items",
  "vendors",
  "property_passports",
  "review_policies",
  "funding_rules",
  "obligations",
  "bills",
  "autopilot_decisions",
  "message_threads",
  "messages",
  "message_reads",
  "notifications",
  "notification_preferences",
  "calendar_events",
  "integrations",
  "webhook_events",
  "domain_events",
  "audit_events",
  "security_signals",
  "feature_flags",
  "billing_accounts",
  "subscriptions",
  "consent_records",
  "idempotency_keys",
  "mfa_recovery_codes",
];

export async function loadDemoData(db: Db, data: DemoData) {
  for (const table of SEED_ORDER) {
    const list = data.rows[table];
    if (!list?.length) continue;
    await (db[table] as unknown as { insertMany(rows: unknown[]): Promise<void> }).insertMany(list);
  }
}
