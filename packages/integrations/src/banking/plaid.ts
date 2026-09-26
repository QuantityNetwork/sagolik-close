/**
 * Plaid adapter (US/CA/EU aggregation).
 *
 * Uses Plaid Hosted Link so the person completes consent, and picks their
 * bank, on Plaid's own pages; Sagolik never sees credentials. Only Identity
 * (ownership) and Balance (proof of funds) are used: Auth isn't requested, so
 * full account and routing numbers never reach us. Endpoints used:
 *   /link/token/create, /link/token/get, /item/public_token/exchange,
 *   /accounts/get, /accounts/balance/get, /transactions/get, /identity/get,
 *   /institutions/get_by_id, /institutions/get, /item/get, /item/remove,
 *   /webhook_verification_key/get
 *
 * This adapter serves deployments without the Go money service. When
 * MONEY_SERVICE_URL is set, bank connections go through the money service
 * instead and access tokens never reach the web app.
 *
 * Status: verified against Plaid's live sandbox (plaid.live.test.ts runs
 * when PLAID_CLIENT_ID and PLAID_SECRET are set).
 */
import type { Currency } from "@sagolik/types";
import { type PlaidJwk, PlaidWebhookVerifier, sha256Hex } from "@sagolik/security";
import { CURRENCIES } from "@sagolik/types";
import { type NormalizedWebhook, type ProviderInfo, ProviderError, WebhookRejectedError } from "../common";
import {
  type BankingProvider,
  type ConnectStart,
  type ExchangeResult,
  type Institution,
  type OwnershipResult,
  type ProviderAccount,
  type ProviderBalance,
  type ProviderBankTransaction,
  type ProviderMortgage,
  namesMatch,
} from "./provider";

const HOSTS = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
} as const;

const USER_MESSAGES: Record<string, { message: string; action?: "reconnect_bank" | "retry" | "contact_support" }> = {
  ITEM_LOGIN_REQUIRED: { message: "Your bank needs you to reconnect before we can refresh the account.", action: "reconnect_bank" },
  INVALID_ACCESS_TOKEN: { message: "Your bank connection is no longer valid. Please reconnect.", action: "reconnect_bank" },
  ITEM_NOT_FOUND: { message: "Your bank connection is no longer valid. Please reconnect.", action: "reconnect_bank" },
  INSTITUTION_DOWN: { message: "Your bank isn't responding right now. Please try again in a little while.", action: "retry" },
  INSTITUTION_NOT_RESPONDING: { message: "Your bank isn't responding right now. Please try again in a little while.", action: "retry" },
  RATE_LIMIT_EXCEEDED: { message: "We're refreshing too often. Please try again in a minute.", action: "retry" },
  PRODUCTS_NOT_SUPPORTED: { message: "This bank doesn't support the information we need. Try another account." },
  PRODUCT_NOT_READY: { message: "Your bank is still preparing its transaction history. Please try again in a few minutes.", action: "retry" },
  NO_LIABILITY_ACCOUNTS: { message: "Your bank didn't report a mortgage on this connection." },
};

function toCurrency(code: string | null | undefined): Currency {
  return (CURRENCIES as readonly string[]).includes(code ?? "") ? (code as Currency) : "USD";
}
const minor = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));

interface PlaidAccount {
  account_id: string;
  name: string;
  mask: string | null;
  subtype: string | null;
  type: string;
  balances: { available: number | null; current: number | null; iso_currency_code: string | null };
  owners?: Array<{ names: string[] }>;
}

export class PlaidBankingProvider implements BankingProvider {
  readonly info: ProviderInfo;
  readonly supportedCountries = ["US", "CA", "GB", "IE", "FR", "ES", "NL", "DE"] as const;
  readonly supportsPaymentInitiation = false;
  readonly providerChoosesInstitution = true;
  readonly activityData: { transactions: boolean; mortgages: boolean };
  private readonly host: string;
  private readonly webhooks: PlaidWebhookVerifier;

  constructor(
    private readonly cfg: {
      clientId: string;
      secret: string;
      env: keyof typeof HOSTS;
      webhookUrl?: string;
      baseUrl?: string;
      /** Opt-in Plaid products for Property Autopilot. Requested as optional: not billed until used. */
      optionalProducts?: ReadonlyArray<"transactions" | "liabilities">;
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.host = cfg.baseUrl ?? HOSTS[cfg.env];
    this.webhooks = new PlaidWebhookVerifier(async (kid) => {
      try {
        const r = await this.call<{ key: PlaidJwk }>("/webhook_verification_key/get", { key_id: kid });
        return r.key;
      } catch (e) {
        if (e instanceof ProviderError && e.opts.retryable) throw e; // Plaid unreachable: let the pipeline answer 5xx
        return null;
      }
    });
    this.activityData = { transactions: !!cfg.optionalProducts?.includes("transactions"), mortgages: !!cfg.optionalProducts?.includes("liabilities") };
    this.info = { id: "plaid", displayName: "Plaid", mode: cfg.env === "production" ? "production" : "sandbox" };
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.host}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: this.cfg.clientId, secret: this.cfg.secret, ...body }),
      });
    } catch (cause) {
      throw new ProviderError("plaid", "NETWORK", "We couldn't reach your bank's connection service. Please try again.", { retryable: true, cause });
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(json.error_code ?? `HTTP_${res.status}`);
      const mapped = USER_MESSAGES[code];
      throw new ProviderError("plaid", code, mapped?.message ?? "Something went wrong talking to your bank. Please try again.", {
        retryable: res.status >= 500 || code === "RATE_LIMIT_EXCEEDED",
        action: mapped?.action,
      });
    }
    return json as T;
  }

  async listInstitutions(country: string): Promise<Institution[]> {
    const r = await this.call<{ institutions: Array<{ institution_id: string; name: string }> }>("/institutions/get", {
      count: 50,
      offset: 0,
      country_codes: [country.toUpperCase()],
    });
    return r.institutions.map((i) => ({ id: i.institution_id, name: i.name, country, logoInitials: i.name.slice(0, 2).toUpperCase() }));
  }

  async getInstitution(id: string): Promise<Institution | null> {
    try {
      const r = await this.call<{ institution: { institution_id: string; name: string; country_codes: string[] } }>("/institutions/get_by_id", {
        institution_id: id,
        country_codes: ["US"],
      });
      return { id, name: r.institution.name, country: r.institution.country_codes[0] ?? "US", logoInitials: r.institution.name.slice(0, 2).toUpperCase() };
    } catch {
      return null;
    }
  }

  async connectBank(opts: { userId: string; fullName: string; institutionId?: string; country: string; redirectUri: string; state: string }): Promise<ConnectStart> {
    const r = await this.call<{ link_token: string; hosted_link_url?: string }>("/link/token/create", {
      user: { client_user_id: opts.userId, legal_name: opts.fullName },
      client_name: "Sagolik Close",
      products: ["identity"],
      ...(this.cfg.optionalProducts?.length ? { optional_products: [...this.cfg.optionalProducts] } : {}),
      ...(this.cfg.optionalProducts?.includes("transactions") ? { transactions: { days_requested: 180 } } : {}),
      country_codes: [opts.country.toUpperCase()],
      language: "en",
      webhook: this.cfg.webhookUrl,
      hosted_link: { completion_redirect_uri: `${opts.redirectUri}?state=${encodeURIComponent(opts.state)}`, url_lifetime_seconds: 1800 },
    });
    if (!r.hosted_link_url) throw new ProviderError("plaid", "NO_HOSTED_LINK", "Bank connections are temporarily unavailable.");
    return { redirectUrl: r.hosted_link_url, state: r.link_token };
  }

  async exchangeAuthorization(opts: { code: string; state: string }): Promise<ExchangeResult> {
    let publicToken = opts.code;
    if (!publicToken) {
      const session = await this.call<{ link_sessions?: Array<{ results?: { item_add_results?: Array<{ public_token: string }> } }> }>(
        "/link/token/get",
        { link_token: opts.state },
      );
      publicToken = session.link_sessions?.[0]?.results?.item_add_results?.[0]?.public_token ?? "";
      if (!publicToken) throw new ProviderError("plaid", "NO_PUBLIC_TOKEN", "The bank didn't confirm the connection. Please try again.");
    }
    const ex = await this.call<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
    const item = await this.call<{ item: { institution_id: string | null; consent_expiration_time: string | null } }>("/item/get", {
      access_token: ex.access_token,
    });
    const inst = item.item.institution_id ? await this.getInstitution(item.item.institution_id) : null;
    return {
      accessToken: ex.access_token,
      externalConnectionId: ex.item_id,
      institution: inst ?? { id: item.item.institution_id ?? "unknown", name: "Your bank", country: "US", logoInitials: "BK" },
      consentCreatedAt: new Date().toISOString(),
      consentExpiresAt: item.item.consent_expiration_time,
    };
  }

  private mapAccount(a: PlaidAccount): ProviderAccount {
    // Cash (depository) accounts are checking or savings for our purposes; credit and loans are "other"
    // (a credit card's "available" amount is its credit limit, not money the person holds).
    const type = a.type === "depository" ? (a.subtype === "checking" ? "checking" : "savings") : a.type === "investment" ? "investment" : "other";
    return { externalAccountId: a.account_id, name: a.name, mask: (a.mask ?? "").slice(-4), currency: toCurrency(a.balances.iso_currency_code), type };
  }

  async listAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const r = await this.call<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: accessToken });
    return r.accounts.map((a) => this.mapAccount(a));
  }

  async getAccount(accessToken: string, externalAccountId: string) {
    return (await this.listAccounts(accessToken)).find((a) => a.externalAccountId === externalAccountId) ?? null;
  }

  async getBalances(accessToken: string): Promise<ProviderBalance[]> {
    const r = await this.call<{ accounts: PlaidAccount[] }>("/accounts/balance/get", { access_token: accessToken });
    const asOf = new Date().toISOString();
    return r.accounts.map((a) => ({
      externalAccountId: a.account_id,
      available: minor(a.balances.available),
      current: minor(a.balances.current),
      currency: toCurrency(a.balances.iso_currency_code),
      asOf,
    }));
  }

  async getTransactions(accessToken: string, range: { from: string; to: string }): Promise<ProviderBankTransaction[]> {
    type Page = { total_transactions: number; transactions: Array<{ transaction_id: string; account_id: string; date: string; name: string; merchant_name?: string | null; amount: number; iso_currency_code: string | null; pending: boolean }> };
    const out: ProviderBankTransaction[] = [];
    // Up to 1,000 transactions, 500 per page; posted transactions only (pending ones can still change).
    for (let offset = 0; offset < 1000; ) {
      const r = await this.call<Page>("/transactions/get", { access_token: accessToken, start_date: range.from, end_date: range.to, options: { count: 500, offset } });
      for (const t of r.transactions) {
        if (t.pending) continue;
        // Plaid: positive amount = money leaving the account. We use negative for outflows.
        out.push({ id: t.transaction_id, externalAccountId: t.account_id, date: t.date, description: t.merchant_name ? `${t.merchant_name} ${t.name}` : t.name, amount: -Math.round(t.amount * 100), currency: toCurrency(t.iso_currency_code) });
      }
      offset += r.transactions.length;
      if (!r.transactions.length || offset >= r.total_transactions) break;
    }
    return out;
  }

  async getMortgages(accessToken: string): Promise<ProviderMortgage[]> {
    let r: { liabilities: { mortgage?: Array<{ account_id: string; next_payment_due_date: string | null; next_monthly_payment: number | null; escrow_balance: number | null; property_address: { street: string | null } | null }> | null } };
    try {
      r = await this.call("/liabilities/get", { access_token: accessToken });
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "NO_LIABILITY_ACCOUNTS" || e.code === "PRODUCTS_NOT_SUPPORTED")) return [];
      throw e;
    }
    const item = await this.call<{ item: { institution_name?: string | null } }>("/item/get", { access_token: accessToken }).catch(() => null);
    const lender = item?.item.institution_name ?? "Your lender";
    return (r.liabilities.mortgage ?? []).map((m) => ({
      externalAccountId: m.account_id,
      lenderName: lender,
      nextPaymentDueOn: m.next_payment_due_date,
      nextMonthlyPayment: minor(m.next_monthly_payment),
      escrowBalance: minor(m.escrow_balance),
      propertyStreet: m.property_address?.street ?? null,
    }));
  }

  async verifyAccountOwnership(accessToken: string, expectedName: string): Promise<OwnershipResult[]> {
    const r = await this.call<{ accounts: PlaidAccount[] }>("/identity/get", { access_token: accessToken });
    return r.accounts.map((a) => {
      const ownerNames = (a.owners ?? []).flatMap((o) => o.names);
      return { externalAccountId: a.account_id, ownerNames, match: ownerNames.some((n) => namesMatch(n, expectedName)) };
    });
  }

  async refreshConnection(accessToken: string) {
    try {
      const r = await this.call<{ item: { error: { error_code: string } | null } }>("/item/get", { access_token: accessToken });
      if (r.item.error?.error_code === "ITEM_LOGIN_REQUIRED") return { status: "reauthentication_required" as const };
      return { status: "connected" as const };
    } catch (e) {
      if (e instanceof ProviderError && e.opts.action === "reconnect_bank") return { status: "reauthentication_required" as const };
      throw e;
    }
  }

  async disconnectBank(accessToken: string) {
    await this.call("/item/remove", { access_token: accessToken });
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<NormalizedWebhook> {
    const reason = await this.webhooks.verify(headers.get("plaid-verification"), rawBody);
    if (reason) throw new WebhookRejectedError(reason);
    let body: { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_code?: string } | null; environment?: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new WebhookRejectedError("invalid_json");
    }
    if (!body.webhook_type || !body.webhook_code) throw new WebhookRejectedError("schema");
    const data = { externalConnectionId: body.item_id ?? "", code: body.webhook_code, errorCode: body.error?.error_code ?? null };
    // Plaid sends no event id; the verified body's hash identifies a delivery.
    const base = { externalEventId: `plaid_${sha256Hex(rawBody)}`, occurredAt: new Date().toISOString(), data };
    if (body.environment && body.environment !== this.cfg.env) return { ...base, eventType: "plaid.other_environment" };
    if (body.webhook_type === "ITEM") {
      switch (body.webhook_code) {
        case "ERROR":
          return { ...base, eventType: body.error?.error_code === "ITEM_LOGIN_REQUIRED" ? "bank.reauth_required" : "bank.error" };
        case "PENDING_EXPIRATION":
        case "PENDING_DISCONNECT":
          return { ...base, eventType: "bank.reauth_required" };
        case "LOGIN_REPAIRED":
          return { ...base, eventType: "bank.repaired" };
        case "USER_PERMISSION_REVOKED":
          return { ...base, eventType: "bank.revoked" };
      }
    }
    return { ...base, eventType: `plaid.${body.webhook_type.toLowerCase()}.${body.webhook_code.toLowerCase()}` };
  }
}
