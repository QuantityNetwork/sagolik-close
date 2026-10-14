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
  /** The same data keys, wrapped by a Key Vault key (DATA_KEK_ID) instead of in clear: "v2:<b64 wrapped>,v1:<b64 wrapped>". */
  DATA_KEYS_WRAPPED: optional,
  /** Key Vault key that wraps the data keys, e.g. https://kv-core.vault.azure.net/keys/data-kek. */
  DATA_KEK_ID: optional,
  SESSION_SECRET: optional,

  /**
   * PostgreSQL without Supabase (Azure Database for PostgreSQL): postgres://<login>@<host>:5432/<db>?sslmode=verify-full.
   * Reads run as `authenticated` with the person's claims (RLS); writes as `service_role`.
   */
  DATABASE_URL: optional,
  /** "entra": sign in with the workload's managed identity (no password anywhere). */
  DATABASE_AUTH: z.enum(["password", "entra"]).default("password"),
  /** Azure Blob Storage for documents, e.g. https://stsagolikprod.blob.core.windows.net. */
  AZURE_STORAGE_BLOB_URL: optional,
  AZURE_STORAGE_CONTAINER: z.string().default("documents"),
  /** The workload's user-assigned managed identity (read by the Azure SDK). */
  AZURE_CLIENT_ID: optional,

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  PLAID_CLIENT_ID: optional,
  PLAID_SECRET: optional,
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Opt-in for Property Autopilot: "transactions,liabilities". Requested as optional products (billed by Plaid once used). */
  PLAID_OPTIONAL_PRODUCTS: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(["transactions", "liabilities"]))),

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

  /**
   * On-chain deal record and wallet proof of funds (record and verify only —
   * nothing here moves money). "sandbox" is the in-memory demo chain; "off"
   * hides the features. Default: sandbox in demo mode, otherwise off.
   */
  CHAIN_NETWORK: z.enum(["off", "sandbox", "base", "base-sepolia", "local"]).optional(),
  /** JSON-RPC endpoint. Defaults to the public Base endpoints (rate-limited; use a provider in production). */
  CHAIN_RPC_URL: optional,
  /** Deployed SagolikDealRegistry address. */
  CHAIN_REGISTRY_ADDRESS: optional,
  /** Private key of the recording account (RECORDER_ROLE only: it can append records, never move money). */
  CHAIN_RECORDER_KEY: optional,
  /** Or, preferably, a Key Vault secp256k1 key that signs inside the HSM: https://kv-core.vault.azure.net/keys/chain-recorder. */
  CHAIN_RECORDER_KEY_ID: optional,
  /** Secret that makes on-chain deal ids unlinkable to transactions (≥32 characters). */
  CHAIN_DEAL_SALT: optional,
  /** Local test networks only: the token to read as USDC. */
  CHAIN_USDC_ADDRESS: optional,

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

export type ChainNetwork = "off" | "sandbox" | "base" | "base-sepolia" | "local";

export type Env = z.infer<typeof EnvSchema> & {
  /** Supabase is configured → real auth + Postgres. Otherwise the in-memory demo store is used. */
  supabaseConfigured: boolean;
  demoMode: boolean;
  /** Resolved CHAIN_NETWORK. */
  chainNetwork: ChainNetwork;
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
  checkKeys(env);
  checkDatabase(env);
  if (env.APP_ENV === "production") {
    if (demoMode) {
      throw new EnvError(
        env.DATABASE_URL
          ? "Production on PostgreSQL needs real sign-in (Microsoft Entra), which isn't wired yet; demo sign-in can't run in production."
          : "Demo mode cannot run in production. Configure Supabase and unset DEMO_MODE.",
      );
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new EnvError("SUPABASE_SERVICE_ROLE_KEY is required in production.");
    if (!env.DATA_ENCRYPTION_KEYS && !env.DATA_KEYS_WRAPPED) throw new EnvError("DATA_ENCRYPTION_KEYS (or DATA_KEYS_WRAPPED with DATA_KEK_ID) is required in production.");
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new EnvError("SESSION_SECRET (≥32 chars) is required in production.");
  }
  const chainNetwork: ChainNetwork = env.CHAIN_NETWORK ?? (demoMode ? "sandbox" : "off");
  checkChain(env, chainNetwork);
  return { ...env, supabaseConfigured, demoMode, chainNetwork };
}

function checkKeys(env: z.infer<typeof EnvSchema>) {
  if (env.DATA_KEYS_WRAPPED && env.DATA_ENCRYPTION_KEYS) throw new EnvError("Set DATA_ENCRYPTION_KEYS or DATA_KEYS_WRAPPED, not both.");
  if (env.DATA_KEYS_WRAPPED && !env.DATA_KEK_ID) throw new EnvError("DATA_KEYS_WRAPPED needs DATA_KEK_ID (the Key Vault key that wraps them).");
  if (env.DATA_KEK_ID && !KEY_VAULT_KEY.test(env.DATA_KEK_ID)) throw new EnvError("DATA_KEK_ID must be a Key Vault key id (https://<vault>.vault.azure.net/keys/<name>).");
  if (env.CHAIN_RECORDER_KEY && env.CHAIN_RECORDER_KEY_ID) throw new EnvError("Set CHAIN_RECORDER_KEY or CHAIN_RECORDER_KEY_ID, not both (prefer the Key Vault key).");
  if (env.CHAIN_RECORDER_KEY_ID && !KEY_VAULT_KEY.test(env.CHAIN_RECORDER_KEY_ID)) throw new EnvError("CHAIN_RECORDER_KEY_ID must be a Key Vault key id (https://<vault>.vault.azure.net/keys/<name>).");
  if (env.APP_ENV === "production" && env.CHAIN_RECORDER_KEY) throw new EnvError("In production the recording key lives in Key Vault: set CHAIN_RECORDER_KEY_ID instead of CHAIN_RECORDER_KEY.");
}

function checkDatabase(env: z.infer<typeof EnvSchema>) {
  if (env.AZURE_STORAGE_BLOB_URL && !env.AZURE_STORAGE_BLOB_URL.startsWith("https://")) throw new EnvError("AZURE_STORAGE_BLOB_URL must be https.");
  if (!env.DATABASE_URL) return;
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new EnvError("DATABASE_URL must look like postgres://<login>@<host>:5432/<database>?sslmode=verify-full.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new EnvError("DATABASE_URL must be a postgres:// URL.");
  if (env.APP_ENV !== "local" && url.searchParams.get("sslmode") !== "verify-full") throw new EnvError("DATABASE_URL must use sslmode=verify-full outside local development.");
  if (env.DATABASE_AUTH === "entra" && url.password) throw new EnvError("With DATABASE_AUTH=entra, DATABASE_URL carries no password: the managed identity signs in.");
  // Supabase manages its own auth schema; the PostgreSQL store's bootstrap would replace auth.uid() there.
  if (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY) throw new EnvError("Use either Supabase or DATABASE_URL, not both.");
  if (env.APP_ENV !== "local" && !env.AZURE_STORAGE_BLOB_URL) throw new EnvError("With DATABASE_URL outside local development, documents need durable storage: set AZURE_STORAGE_BLOB_URL.");
}

const KEY_VAULT_KEY = /^https:\/\/[a-z0-9-]+\.(vault\.azure\.net|managedhsm\.azure\.net)\/keys\/[A-Za-z0-9-]+(\/[0-9a-f]{32})?$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

function checkChain(env: z.infer<typeof EnvSchema>, network: ChainNetwork) {
  if (env.APP_ENV === "production" && network !== "off" && network !== "base") {
    throw new EnvError(`CHAIN_NETWORK must be base or off in production (got ${network}): sandbox and test networks aren't a public record.`);
  }
  if (env.CHAIN_USDC_ADDRESS && network !== "local") throw new EnvError("CHAIN_USDC_ADDRESS is only for local test networks; Base uses Circle's USDC.");
  if (network === "off" || network === "sandbox") return;
  if (!env.CHAIN_REGISTRY_ADDRESS || !ADDRESS.test(env.CHAIN_REGISTRY_ADDRESS)) throw new EnvError(`CHAIN_REGISTRY_ADDRESS (0x…, 40 hex characters) is required when CHAIN_NETWORK=${network}.`);
  if (!env.CHAIN_DEAL_SALT || env.CHAIN_DEAL_SALT.length < 32) throw new EnvError(`CHAIN_DEAL_SALT (≥32 characters) is required when CHAIN_NETWORK=${network}.`);
  if (env.CHAIN_RECORDER_KEY && !PRIVATE_KEY.test(env.CHAIN_RECORDER_KEY)) throw new EnvError("CHAIN_RECORDER_KEY must be a 0x-prefixed 32-byte hex private key.");
  if (network === "local" && (!env.CHAIN_RPC_URL || !env.CHAIN_USDC_ADDRESS)) throw new EnvError("CHAIN_NETWORK=local needs CHAIN_RPC_URL and CHAIN_USDC_ADDRESS.");
  if (env.CHAIN_RPC_URL && env.APP_ENV !== "local" && !env.CHAIN_RPC_URL.startsWith("https://")) throw new EnvError("CHAIN_RPC_URL must be https outside local development.");
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= parseEnv();
  return cached;
}

/** Local-only fallback secrets. Refused in production by `parseEnv`. */
export const LOCAL_SESSION_SECRET = "local-dev-session-secret-not-for-production-use-000";
export const LOCAL_ENCRYPTION_KEYS = "v1:bG9jYWwtZGV2LWtleS1ub3QtZm9yLXByb2QtdXNlISE=";
