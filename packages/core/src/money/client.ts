/**
 * Client for the Go money service (services/money). Every call goes over
 * mutual TLS and carries a fresh, single-use user assertion signed by the web
 * app, so the money service can re-check every rule itself.
 */
import { request as httpsRequest, Agent } from "node:https";
import { readFileSync } from "node:fs";
import type { KeyObject } from "node:crypto";
import { assertionSigningKey, signUserAssertion } from "@sagolik/security";
import type { ErrorCode } from "@sagolik/types";

export interface MoneyClientConfig {
  baseUrl: string;
  ca: string | Buffer;
  cert: string | Buffer;
  key: string | Buffer;
  signingKey: KeyObject;
  kid: string;
  timeoutMs?: number;
}

/** Who is asking, for one call. */
export interface MoneyCaller {
  userId: string;
  transactionId: string;
  role: string;
  aal2: boolean;
  stepUpAt: Date | null;
}

export interface MoneyInstruction {
  id: string;
  transactionId: string;
  purpose: string;
  version: number;
  previousId: string | null;
  beneficiaryName: string;
  bankName: string;
  routingNumber: string;
  accountMask: string;
  currency: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  effectiveAfter: string | null;
  createdBy: string;
  createdAt: string;
  status: "pending_verification" | "verified" | "rejected" | "superseded";
  usable: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationMethod: string | null;
}

export interface MoneyBalance {
  currency: string;
  expected: number;
  outstanding: number;
  received: number;
  disbursed: number;
}

const KNOWN_CODES = new Set<string>([
  "bad_request", "unauthenticated", "forbidden", "not_found", "conflict", "step_up_required", "rate_limited", "idempotency_conflict", "unavailable", "internal",
]);

export class MoneyServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly userMessage: string,
  ) {
    super(`money service: ${status} ${code}`);
    this.name = "MoneyServiceError";
  }
}

export class MoneyServiceClient {
  private readonly agent: Agent;
  private readonly base: URL;

  constructor(private readonly cfg: MoneyClientConfig) {
    this.base = new URL(cfg.baseUrl);
    if (this.base.protocol !== "https:") throw new Error("MONEY_SERVICE_URL must be https (mutual TLS)");
    this.agent = new Agent({ ca: cfg.ca, cert: cfg.cert, key: cfg.key, minVersion: "TLSv1.3", keepAlive: true });
  }

  /** Builds a client from file paths (see .env.example). */
  static fromFiles(opts: { url: string; caFile: string; certFile: string; keyFile: string; signingJwkFile: string; kid: string }) {
    return new MoneyServiceClient({
      baseUrl: opts.url,
      ca: readFileSync(opts.caFile),
      cert: readFileSync(opts.certFile),
      key: readFileSync(opts.keyFile),
      signingKey: assertionSigningKey(JSON.parse(readFileSync(opts.signingJwkFile, "utf8"))),
      kid: opts.kid,
    });
  }

  session(caller: MoneyCaller) {
    return this.call<{ userId: string; aal: string; role?: string }>("GET", "/v1/session", caller);
  }

  funds(caller: MoneyCaller) {
    return this.call<{ transactionId: string; balances: MoneyBalance[] }>("GET", `/v1/transactions/${caller.transactionId}/funds`, caller);
  }

  listInstructions(caller: MoneyCaller) {
    return this.call<{ instructions: MoneyInstruction[] }>("GET", `/v1/transactions/${caller.transactionId}/instructions`, caller);
  }

  createInstruction(
    caller: MoneyCaller,
    body: { purpose: string; beneficiaryName: string; bankName: string; routingNumber: string; accountNumber: string; currency: string; hoursToClosing?: number },
  ) {
    return this.call<{ instruction: MoneyInstruction }>("POST", `/v1/transactions/${caller.transactionId}/instructions`, caller, body);
  }

  verifyInstruction(caller: MoneyCaller, instructionId: string, body: { method: string; reference: string }) {
    return this.call<{ instruction: MoneyInstruction }>("POST", `/v1/instructions/${encodeURIComponent(instructionId)}/verify`, caller, body);
  }

  revealInstruction(caller: MoneyCaller, instructionId: string) {
    return this.call<{ instruction: MoneyInstruction; accountNumber: string }>("POST", `/v1/instructions/${encodeURIComponent(instructionId)}/reveal`, caller, {});
  }

  recordMovement(caller: MoneyCaller, body: { kind: "expectation" | "receipt" | "disbursement"; amount: number; currency: string; reference: string; idempotencyKey: string }) {
    return this.call<{ groupId: string; created: boolean; balances: MoneyBalance[] }>("POST", `/v1/transactions/${caller.transactionId}/ledger/movements`, caller, body);
  }

  private call<T>(method: "GET" | "POST", path: string, caller: MoneyCaller, body?: unknown): Promise<T> {
    const token = signUserAssertion(
      { userId: caller.userId, transactionId: caller.transactionId, role: caller.role, aal2: caller.aal2, stepUpAt: caller.stepUpAt },
      { privateKey: this.cfg.signingKey, kid: this.cfg.kid },
    );
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const url = new URL(path, this.base);
    return new Promise<T>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method,
          agent: this.agent,
          timeout: this.cfg.timeoutMs ?? 10_000,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            let json: unknown = null;
            try {
              json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              /* handled below */
            }
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300 && json) return resolve(json as T);
            const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
            const code = (err?.code && KNOWN_CODES.has(err.code) ? err.code : "provider_error") as ErrorCode;
            reject(new MoneyServiceError(status, code, err?.message ?? "The payments service didn't respond as expected. Nothing was changed."));
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("money service timeout")));
      req.on("error", () => reject(new MoneyServiceError(503, "unavailable", "The payments service is unavailable right now. Nothing was changed; please try again shortly.")));
      if (payload) req.write(payload);
      req.end();
    });
  }
}
