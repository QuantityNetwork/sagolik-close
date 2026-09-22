import type { Currency } from "@sagolik/types";
import type { ProviderInfo, WebhookCapable } from "../common";

export interface Institution {
  id: string;
  name: string;
  country: string;
  logoInitials: string;
}

export interface ProviderAccount {
  externalAccountId: string;
  name: string;
  mask: string;
  currency: Currency;
  type: "checking" | "savings" | "investment" | "other";
}

export interface ProviderBalance {
  externalAccountId: string;
  /** Minor units. */
  available: number | null;
  current: number | null;
  currency: Currency;
  asOf: string;
}

export interface ProviderBankTransaction {
  id: string;
  externalAccountId: string;
  date: string;
  description: string;
  /** Minor units; negative = outflow. */
  amount: number;
  currency: Currency;
}

export interface OwnershipResult {
  externalAccountId: string;
  ownerNames: string[];
  match: boolean;
}

export interface ConnectStart {
  /** Where to send the person: the provider-hosted consent flow. Never our own password form. */
  redirectUrl: string;
  /** Opaque reference to correlate the callback. */
  state: string;
}

export interface ExchangeResult {
  accessToken: string;
  externalConnectionId: string;
  institution: Institution;
  consentCreatedAt: string;
  consentExpiresAt: string | null;
}

/**
 * Open-banking / account-aggregation provider.
 *
 * Sagolik Close NEVER collects online-banking credentials. `connectBank`
 * returns a provider-hosted consent URL; tokens come back via
 * `exchangeAuthorization` and are encrypted at rest by the caller.
 */
export interface BankingProvider extends WebhookCapable {
  readonly info: ProviderInfo;
  readonly supportedCountries: readonly string[];
  readonly supportsPaymentInitiation: boolean;

  listInstitutions(country: string): Promise<Institution[]>;
  getInstitution(id: string): Promise<Institution | null>;
  connectBank(opts: { userId: string; fullName: string; institutionId: string; country: string; redirectUri: string; state: string }): Promise<ConnectStart>;
  exchangeAuthorization(opts: { code: string; state: string }): Promise<ExchangeResult>;
  listAccounts(accessToken: string): Promise<ProviderAccount[]>;
  getAccount(accessToken: string, externalAccountId: string): Promise<ProviderAccount | null>;
  getBalances(accessToken: string): Promise<ProviderBalance[]>;
  getTransactions(accessToken: string, range: { from: string; to: string }): Promise<ProviderBankTransaction[]>;
  verifyAccountOwnership(accessToken: string, expectedName: string): Promise<OwnershipResult[]>;
  refreshConnection(accessToken: string): Promise<{ status: "connected" | "reauthentication_required" | "expired" | "revoked" }>;
  disconnectBank(accessToken: string): Promise<void>;
}

/** Loose name match: case/diacritic-insensitive, order-insensitive tokens. */
export function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .sort()
      .join(" ");
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(" "));
  const tb = nb.split(" ");
  const shared = tb.filter((t) => ta.has(t)).length;
  return shared >= 2 || (shared >= 1 && Math.min(ta.size, tb.length) === 1);
}
