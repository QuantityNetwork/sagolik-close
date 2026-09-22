import type { ProviderInfo } from "../common";

/** Homeowner's / title insurance binding. Planned integration; manual evidence upload today. */
export interface InsuranceProvider {
  readonly info: ProviderInfo;
  readonly supportsApi: boolean;
  getPolicy(externalReference: string): Promise<{ policyNumber: string; carrier: string; effectiveDate: string; bound: boolean } | null>;
}

export class ManualInsuranceProvider implements InsuranceProvider {
  readonly info: ProviderInfo = { id: "manual_insurance", displayName: "Insurance (document upload)", mode: "mock" };
  readonly supportsApi = false;
  async getPolicy() {
    return null;
  }
}
