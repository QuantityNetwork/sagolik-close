import type { Currency } from "@sagolik/types";
import { MockProviderBase, ProviderError, randomRef, type ProviderInfo } from "../common";
import { globalSingleton } from "../singleton";
import {
  type BankingProvider,
  type ConnectStart,
  type ExchangeResult,
  type Institution,
  type OwnershipResult,
  type ProviderAccount,
  type ProviderBalance,
  type ProviderBankTransaction,
  namesMatch,
} from "./provider";

const INSTITUTIONS: Institution[] = [
  { id: "mock_chase", name: "Chase", country: "US", logoInitials: "CH" },
  { id: "mock_boa", name: "Bank of America", country: "US", logoInitials: "BA" },
  { id: "mock_wells", name: "Wells Fargo", country: "US", logoInitials: "WF" },
  { id: "mock_nordea", name: "Nordea", country: "SE", logoInitials: "ND" },
  { id: "mock_seb", name: "SEB", country: "SE", logoInitials: "SE" },
  { id: "mock_handelsbanken", name: "Handelsbanken", country: "SE", logoInitials: "HB" },
  { id: "mock_pko", name: "PKO Bank Polski", country: "PL", logoInitials: "PK" },
  { id: "mock_db", name: "Deutsche Bank", country: "DE", logoInitials: "DB" },
  { id: "mock_ubs", name: "UBS", country: "CH", logoInitials: "UB" },
  // Exercises the reconnect path: every refresh reports that consent must be renewed.
  { id: "mock_expiring", name: "Sandbox Bank (expiring consent)", country: "US", logoInitials: "SB" },
];

const CURRENCY_BY_COUNTRY: Record<string, Currency> = { US: "USD", SE: "SEK", PL: "PLN", DE: "EUR", CH: "CHF", LI: "CHF" };

interface PendingConsent {
  state: string;
  userId: string;
  fullName: string;
  institutionId: string;
  country: string;
  code?: string;
}

interface MockConnection {
  accessToken: string;
  externalConnectionId: string;
  institution: Institution;
  ownerName: string;
  currency: Currency;
  revoked: boolean;
  seed: number;
  /** Fixed account masks (seeded demo data). */
  masks?: [string, string];
}

interface MockBankState {
  pending: Map<string, PendingConsent>;
  connections: Map<string, MockConnection>;
}

function seeded(n: number) {
  // Deterministic pseudo-random for stable demo balances.
  let x = n || 1;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

/**
 * Sandbox open-banking provider. Consent happens on the Sagolik sandbox page
 * (`/sandbox/bank`), which mimics a provider-hosted consent screen and never
 * asks for a password. All data is fictional.
 */
export class MockBankingProvider extends MockProviderBase implements BankingProvider {
  readonly info: ProviderInfo = { id: "mock_banking", displayName: "Sandbox Open Banking", mode: "mock" };
  readonly supportedCountries = ["US", "SE", "PL", "DE", "CH", "LI"] as const;
  readonly supportsPaymentInitiation = true;
  private state = globalSingleton<MockBankState>("mock_bank_state", () => ({ pending: new Map(), connections: new Map() }));

  constructor(
    webhookSecret: string,
    private readonly appUrl: string,
  ) {
    super(webhookSecret);
  }

  async listInstitutions(country: string) {
    return INSTITUTIONS.filter((i) => i.country === country.toUpperCase());
  }

  async getInstitution(id: string) {
    return INSTITUTIONS.find((i) => i.id === id) ?? null;
  }

  async connectBank(opts: { userId: string; fullName: string; institutionId: string; country: string; redirectUri: string; state: string }): Promise<ConnectStart> {
    const inst = await this.getInstitution(opts.institutionId);
    if (!inst) throw new ProviderError(this.info.id, "INSTITUTION_NOT_FOUND", "We couldn't find that bank. Please choose another.");
    this.state.pending.set(opts.state, { state: opts.state, userId: opts.userId, fullName: opts.fullName, institutionId: inst.id, country: opts.country });
    const url = new URL("/sandbox/bank", this.appUrl);
    url.searchParams.set("state", opts.state);
    url.searchParams.set("redirect_uri", opts.redirectUri);
    return { redirectUrl: url.toString(), state: opts.state };
  }

  /** Called by the sandbox consent page when the person approves. */
  approveConsent(state: string): string {
    const p = this.state.pending.get(state);
    if (!p) throw new ProviderError(this.info.id, "CONSENT_NOT_FOUND", "This bank connection request has expired. Please start again.");
    p.code = randomRef("code");
    return p.code;
  }

  pendingConsent(state: string): (PendingConsent & { institution: Institution | null }) | null {
    const p = this.state.pending.get(state);
    return p ? { ...p, institution: INSTITUTIONS.find((i) => i.id === p.institutionId) ?? null } : null;
  }

  async exchangeAuthorization(opts: { code: string; state: string }): Promise<ExchangeResult> {
    const p = this.state.pending.get(opts.state);
    if (!p || !p.code || p.code !== opts.code) {
      throw new ProviderError(this.info.id, "INVALID_AUTHORIZATION", "The bank didn't confirm the connection. Please try again.");
    }
    this.state.pending.delete(opts.state);
    const institution = INSTITUTIONS.find((i) => i.id === p.institutionId)!;
    const accessToken = randomRef("access-sandbox");
    const externalConnectionId = randomRef("item");
    const seed = [...p.userId].reduce((a, c) => a + c.charCodeAt(0), 0);
    this.state.connections.set(accessToken, {
      accessToken,
      externalConnectionId,
      institution,
      ownerName: p.fullName,
      currency: CURRENCY_BY_COUNTRY[institution.country] ?? "USD",
      revoked: false,
      seed,
    });
    const now = new Date();
    return {
      accessToken,
      externalConnectionId,
      institution,
      consentCreatedAt: now.toISOString(),
      consentExpiresAt: new Date(now.getTime() + 90 * 86_400_000).toISOString(),
    };
  }

  private conn(accessToken: string): MockConnection {
    const c = this.state.connections.get(accessToken);
    if (!c || c.revoked) throw new ProviderError(this.info.id, "ITEM_NOT_FOUND", "Your bank needs you to reconnect before we can refresh the account.", { action: "reconnect_bank" });
    if (c.institution.id === "mock_expiring") {
      throw new ProviderError(this.info.id, "ITEM_LOGIN_REQUIRED", "Your bank needs you to reconnect before we can refresh the account.", { action: "reconnect_bank" });
    }
    return c;
  }

  async listAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const c = this.state.connections.get(accessToken);
    if (!c || c.revoked) throw new ProviderError(this.info.id, "ITEM_NOT_FOUND", "Your bank needs you to reconnect.", { action: "reconnect_bank" });
    const r = seeded(c.seed);
    const m1 = c.masks?.[0] ?? String(1000 + Math.floor(r() * 8999));
    const m2 = c.masks?.[1] ?? String(1000 + Math.floor(r() * 8999));
    return [
      { externalAccountId: `${c.externalConnectionId}_chk`, name: "Everyday Checking", mask: m1, currency: c.currency, type: "checking" },
      { externalAccountId: `${c.externalConnectionId}_sav`, name: "High-Yield Savings", mask: m2, currency: c.currency, type: "savings" },
    ];
  }

  async getAccount(accessToken: string, externalAccountId: string) {
    return (await this.listAccounts(accessToken)).find((a) => a.externalAccountId === externalAccountId) ?? null;
  }

  async getBalances(accessToken: string): Promise<ProviderBalance[]> {
    const c = this.conn(accessToken);
    const r = seeded(c.seed + 7);
    const asOf = new Date().toISOString();
    const accounts = await this.listAccounts(accessToken);
    return accounts.map((a, i) => {
      const major = i === 0 ? 38_000 + Math.floor(r() * 20_000) : 190_000 + Math.floor(r() * 60_000);
      const amount = major * 100;
      return { externalAccountId: a.externalAccountId, available: amount, current: amount, currency: a.currency, asOf };
    });
  }

  async getTransactions(accessToken: string, range: { from: string; to: string }): Promise<ProviderBankTransaction[]> {
    const c = this.conn(accessToken);
    const [acct] = await this.listAccounts(accessToken);
    const r = seeded(c.seed + 13);
    const out: ProviderBankTransaction[] = [];
    const start = new Date(range.from).getTime();
    const end = new Date(range.to).getTime();
    for (let t = start, i = 0; t <= end && i < 60; t += 3 * 86_400_000, i++) {
      const salary = i % 10 === 0;
      out.push({
        id: `${c.externalConnectionId}_tx_${i}`,
        externalAccountId: acct!.externalAccountId,
        date: new Date(t).toISOString().slice(0, 10),
        description: salary ? "Payroll deposit" : ["Grocery", "Utilities", "Transfer to savings", "Pharmacy"][i % 4]!,
        amount: salary ? 820_000 : -Math.floor(2_000 + r() * 30_000),
        currency: c.currency,
      });
    }
    return out;
  }

  async verifyAccountOwnership(accessToken: string, expectedName: string): Promise<OwnershipResult[]> {
    const c = this.conn(accessToken);
    const accounts = await this.listAccounts(accessToken);
    return accounts.map((a) => ({ externalAccountId: a.externalAccountId, ownerNames: [c.ownerName], match: namesMatch(c.ownerName, expectedName) }));
  }

  async refreshConnection(accessToken: string) {
    const c = this.state.connections.get(accessToken);
    if (!c || c.revoked) return { status: "revoked" as const };
    if (c.institution.id === "mock_expiring") {
      await this.emit("bank.reauth_required", { externalConnectionId: c.externalConnectionId });
      return { status: "reauthentication_required" as const };
    }
    return { status: "connected" as const };
  }

  async disconnectBank(accessToken: string) {
    const c = this.state.connections.get(accessToken);
    if (c) c.revoked = true;
  }

  /** Restores a connection for seeded demo data (the token is a fixed demo token). */
  seedConnection(opts: { accessToken: string; externalConnectionId: string; institutionId: string; ownerName: string; seed: number; masks?: [string, string] }) {
    const institution = INSTITUTIONS.find((i) => i.id === opts.institutionId)!;
    if (this.state.connections.has(opts.accessToken)) return;
    this.state.connections.set(opts.accessToken, {
      accessToken: opts.accessToken,
      externalConnectionId: opts.externalConnectionId,
      institution,
      ownerName: opts.ownerName,
      currency: CURRENCY_BY_COUNTRY[institution.country] ?? "USD",
      revoked: false,
      seed: opts.seed,
      masks: opts.masks,
    });
  }
}
