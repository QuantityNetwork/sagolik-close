/**
 * Server environment. Parsed once, validated with Zod, never exposed to the
 * browser (only NEXT_PUBLIC_* values are). Missing provider keys are not
 * errors: the provider registry falls back to clearly-labelled mock adapters.
 */
import { z } from "zod";

export const APP_ENVS = ["local", "development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  NEXT_PUBLIC_SUPABASE_URL: optional,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,

  /** 32-byte base64 key(s) for encrypting provider tokens and account numbers. Format: "v1:<b64>,v2:<b64>". */
  DATA_ENCRYPTION_KEYS: optional,
  SESSION_SECRET: optional,

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  PLAID_CLIENT_ID: optional,
  PLAID_SECRET: optional,
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),

  TRUELAYER_CLIENT_ID: optional,
  TRUELAYER_CLIENT_SECRET: optional,

  PERSONA_API_KEY: optional,
  PERSONA_WEBHOOK_SECRET: optional,

  DOCUSIGN_INTEGRATION_KEY: optional,
  DOCUSIGN_WEBHOOK_SECRET: optional,

  RESEND_API_KEY: optional,
  EMAIL_FROM: z.string().default("Sagolik Close <no-reply@close.sagolik.com>"),
  /** Where contact-form enquiries are delivered. Unset → enquiries are only kept in the outbox (demo). */
  CONTACT_INBOX: optional,
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  TWILIO_FROM_NUMBER: optional,

  SENTRY_DSN: optional,
  NEXT_PUBLIC_POSTHOG_KEY: optional,

  /** Go money service (services/money). When set, instructions and escrow-reported movements live there. */
  MONEY_SERVICE_URL: optional,
  MONEY_SERVICE_CA_FILE: optional,
  MONEY_SERVICE_CERT_FILE: optional,
  MONEY_SERVICE_KEY_FILE: optional,
  /** Ed25519 private JWK used to sign per-request user assertions for the money service. */
  MONEY_ASSERTION_SIGNING_JWK_FILE: optional,
  MONEY_ASSERTION_KID: z.string().default("web-1"),

  /** Shared secret used by the built-in mock providers to sign their webhooks. */
  MOCK_WEBHOOK_SECRET: z.string().default("mock_webhook_secret_local_only"),
  /** Public demo deployments: rebuild the in-memory demo every N hours so visitors start fresh (0 = never). */
  DEMO_RESET_HOURS: z.coerce.number().min(0).default(0),
  /** Explicitly allow demo mode (seeded fictional data, persona sign-in). Never true in production. */
  DEMO_MODE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema> & {
  /** Supabase is configured → real auth + Postgres. Otherwise the in-memory demo store is used. */
  supabaseConfigured: boolean;
  demoMode: boolean;
};

export class EnvError extends Error {}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new EnvError(`Invalid environment: ${issues}`);
  }
  const env = parsed.data;
  const supabaseConfigured = !!(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const demoMode = env.DEMO_MODE || !supabaseConfigured;

  if (env.APP_ENV === "production" && env.PLAID_CLIENT_ID && env.PLAID_ENV !== "production") {
    throw new EnvError("PLAID_ENV must be production when APP_ENV is production (sandbox keys only reach Plaid's test banks).");
  }
  if (env.MONEY_SERVICE_URL) {
    const missing = (["MONEY_SERVICE_CA_FILE", "MONEY_SERVICE_CERT_FILE", "MONEY_SERVICE_KEY_FILE", "MONEY_ASSERTION_SIGNING_JWK_FILE"] as const).filter((k) => !env[k]);
    if (missing.length) throw new EnvError(`MONEY_SERVICE_URL is set, so ${missing.join(", ")} must be set too (mutual TLS and signed assertions).`);
    if (!env.MONEY_SERVICE_URL.startsWith("https://")) throw new EnvError("MONEY_SERVICE_URL must be https (mutual TLS).");
  }
  // Any deployed environment signs sessions with its own secret — the local fallback is public.
  if (env.APP_ENV !== "local" && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
    throw new EnvError(`SESSION_SECRET (≥32 chars) is required when APP_ENV=${env.APP_ENV}.`);
  }
  if (env.APP_ENV === "production") {
    if (demoMode) throw new EnvError("Demo mode cannot run in production. Configure Supabase and unset DEMO_MODE.");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new EnvError("SUPABASE_SERVICE_ROLE_KEY is required in production.");
    if (!env.DATA_ENCRYPTION_KEYS) throw new EnvError("DATA_ENCRYPTION_KEYS is required in production.");
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new EnvError("SESSION_SECRET (≥32 chars) is required in production.");
  }
  return { ...env, supabaseConfigured, demoMode };
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Local-only fallback secrets. Refused in production by `parseEnv`. */
export const LOCAL_SESSION_SECRET = "local-dev-session-secret-not-for-production-use-000";
export const LOCAL_ENCRYPTION_KEYS = "v1:bG9jYWwtZGV2LWtleS1ub3QtZm9yLXByb2QtdXNlISE=";
