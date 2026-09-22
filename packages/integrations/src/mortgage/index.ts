import type { MortgageStatus } from "@sagolik/types";
import type { ProviderInfo } from "../common";

export interface LenderLoanStatus {
  status: MortgageStatus;
  conditions: Array<{ externalId: string; description: string; satisfied: boolean }>;
  clearToCloseAt: string | null;
}

/**
 * Lender / LOS integration (Encompass, Blend, MeridianLink, …).
 *
 * Where no API exists, lenders use the `manual` adapter: an authorized
 * loan officer updates status in Sagolik (audited), or shares documents
 * through the vault. Status updates never come from buyers.
 */
export interface MortgageProvider {
  readonly info: ProviderInfo;
  readonly supportsApi: boolean;
  getLoanStatus(externalReference: string): Promise<LenderLoanStatus | null>;
}

export class ManualMortgageProvider implements MortgageProvider {
  readonly info: ProviderInfo = { id: "manual_mortgage", displayName: "Lender portal (manual updates)", mode: "mock" };
  readonly supportsApi = false;
  async getLoanStatus() {
    return null;
  }
}
