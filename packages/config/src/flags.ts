/**
 * Feature flags. Defaults live here. At runtime they can be overridden per
 * environment and per organization via the `feature_flags` table.
 */
export const FEATURE_FLAGS = {
  bank_integrations: { description: "Open-banking connections and balances", default: true },
  payment_initiation: { description: "Initiate payments through a provider (vs. instructions only)", default: false },
  ai_assistant: { description: "Sagolik Assistant answering questions from structured transaction data", default: true },
  mortgage_integrations: { description: "Live lender API integrations", default: false },
  title_integrations: { description: "Live title-company integrations", default: false },
  international_markets: { description: "Non-US jurisdictions (SE, PL, DE, LI, CH)", default: false },
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export interface FlagOverride {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  organizationIds: string[];
}

/** Deterministic bucketing so a subject stays in or out of a rollout consistently. */
function bucket(subject: string, key: string): number {
  let h = 2166136261;
  for (const ch of `${key}:${subject}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}

export function isFlagEnabled(
  key: FeatureFlagKey,
  opts: { overrides?: FlagOverride[]; organizationId?: string | null; subjectId?: string | null } = {},
): boolean {
  const o = opts.overrides?.find((x) => x.key === key);
  if (!o) return FEATURE_FLAGS[key].default;
  if (!o.enabled) return false;
  if (opts.organizationId && o.organizationIds.includes(opts.organizationId)) return true;
  if (o.rolloutPercent >= 100) return true;
  if (o.rolloutPercent <= 0) return false;
  return bucket(opts.subjectId ?? opts.organizationId ?? "anonymous", key) < o.rolloutPercent;
}
