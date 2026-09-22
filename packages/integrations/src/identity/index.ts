import type { IdentityChecks, IdentityStatus } from "@sagolik/types";
import { MockProviderBase, ProviderError, randomRef, type ProviderInfo, type WebhookCapable } from "../common";
import { globalSingleton } from "../singleton";

export interface StartVerificationInput {
  referenceId: string; // our participant/user id — used to correlate webhooks
  fullName: string;
  email: string;
  country: string;
  livenessRequired: boolean;
  redirectUri: string;
}

export interface VerificationResult {
  externalId: string;
  status: IdentityStatus;
  checks: IdentityChecks;
  failureReason: string | null;
}

/**
 * Identity verification (KYC). Results are stored minimally: status + check
 * outcomes. Raw ID images stay with the provider unless a jurisdiction
 * requires retention (see docs/compliance-boundaries.md).
 *
 * Candidate production adapters: Persona, Veriff, Stripe Identity, Onfido,
 * Signicat (BankID SE / itsme / eIDAS).
 */
export interface IdentityProvider extends WebhookCapable {
  readonly info: ProviderInfo;
  startVerification(input: StartVerificationInput): Promise<{ externalId: string; hostedUrl: string }>;
  getVerification(externalId: string): Promise<VerificationResult>;
}

const NOT_STARTED: IdentityChecks = { document: "not_started", liveness: "not_started", address: "not_started", sanctions: "not_started", pep: "not_started" };

interface MockSession {
  externalId: string;
  referenceId: string;
  fullName: string;
  livenessRequired: boolean;
  result: VerificationResult;
}

/**
 * Sandbox KYC. The hosted flow is `/sandbox/identity`, clearly labelled as a
 * simulation. Outcome scenarios: approve, needs review, or fail.
 */
export class MockIdentityProvider extends MockProviderBase implements IdentityProvider {
  readonly info: ProviderInfo = { id: "mock_identity", displayName: "Sandbox Identity", mode: "mock" };
  private sessions = globalSingleton("mock_identity_sessions", () => new Map<string, MockSession>());

  constructor(
    webhookSecret: string,
    private readonly appUrl: string,
  ) {
    super(webhookSecret);
  }

  async startVerification(input: StartVerificationInput) {
    const externalId = randomRef("inq");
    this.sessions.set(externalId, {
      externalId,
      referenceId: input.referenceId,
      fullName: input.fullName,
      livenessRequired: input.livenessRequired,
      result: { externalId, status: "pending", checks: NOT_STARTED, failureReason: null },
    });
    const url = new URL("/sandbox/identity", this.appUrl);
    url.searchParams.set("inquiry", externalId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    return { externalId, hostedUrl: url.toString() };
  }

  session(externalId: string) {
    return this.sessions.get(externalId) ?? null;
  }

  /** Called by the sandbox hosted flow. Emits a signed webhook like a real provider. */
  async complete(externalId: string, outcome: "approve" | "review" | "fail") {
    const s = this.sessions.get(externalId);
    if (!s) throw new ProviderError(this.info.id, "NOT_FOUND", "This verification session has expired. Please start again.");
    const passed: IdentityStatus = "verified";
    s.result =
      outcome === "approve"
        ? { externalId, status: "verified", checks: { document: passed, liveness: s.livenessRequired ? passed : "not_started", address: passed, sanctions: passed, pep: passed }, failureReason: null }
        : outcome === "review"
          ? { externalId, status: "review_required", checks: { document: passed, liveness: "review_required", address: passed, sanctions: passed, pep: "review_required" }, failureReason: "A possible politically-exposed-person match needs manual review." }
          : { externalId, status: "failed", checks: { document: "failed", liveness: "failed", address: "not_started", sanctions: "not_started", pep: "not_started" }, failureReason: "The ID document could not be verified." };
    await this.emit("identity.verification.completed", { externalId, referenceId: s.referenceId, status: s.result.status });
    return s.result;
  }

  async getVerification(externalId: string): Promise<VerificationResult> {
    const s = this.sessions.get(externalId);
    if (!s) throw new ProviderError(this.info.id, "NOT_FOUND", "We couldn't find that verification.");
    return s.result;
  }
}
