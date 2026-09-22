import type { ProviderInfo } from "../common";

export interface PropertyDetails {
  parcelId: string | null;
  latitude: number | null;
  longitude: number | null;
  propertyType: string;
  yearBuilt: number | null;
  livingArea: number | null;
  areaUnit: "sqft" | "sqm";
  bedrooms: number | null;
  bathrooms: number | null;
  lotSize: number | null;
  propertyTaxAnnual: number | null;
  legalDescription: string | null;
  source: string;
}

/**
 * Property data. Coverage is market-specific (ATTOM/CoreLogic/Estated/Regrid
 * in the US, national land registries elsewhere), so the registry selects a
 * provider per country rather than assuming one global source.
 */
export interface PropertyProvider {
  readonly info: ProviderInfo;
  readonly countries: readonly string[];
  lookup(address: { line1: string; city: string; region?: string; postalCode?: string; country: string }): Promise<PropertyDetails | null>;
}

/** Returns no data rather than inventing it: fields stay empty until a real source fills them. */
export class ManualPropertyProvider implements PropertyProvider {
  readonly info: ProviderInfo = { id: "manual_property", displayName: "Manual entry", mode: "mock" };
  readonly countries = ["*"] as const;
  async lookup() {
    return null;
  }
}
