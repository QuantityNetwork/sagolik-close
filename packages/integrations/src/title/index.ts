import type { TitleStatus } from "@sagolik/types";
import type { ProviderInfo } from "../common";

export interface TitleSearchResult {
  status: TitleStatus;
  currentOwner: string | null;
  issues: Array<{ externalId: string; kind: "lien" | "mortgage" | "judgment" | "easement" | "encumbrance" | "tax" | "other"; description: string; amount: number | null }>;
}

/** Title search / title insurance (title plants, underwriter APIs, land registries). */
export interface TitleProvider {
  readonly info: ProviderInfo;
  readonly supportsApi: boolean;
  orderSearch(opts: { parcelId: string | null; address: string }): Promise<{ externalReference: string } | null>;
  getSearch(externalReference: string): Promise<TitleSearchResult | null>;
}

export class ManualTitleProvider implements TitleProvider {
  readonly info: ProviderInfo = { id: "manual_title", displayName: "Title officer (manual updates)", mode: "mock" };
  readonly supportsApi = false;
  async orderSearch() {
    return null;
  }
  async getSearch() {
    return null;
  }
}
