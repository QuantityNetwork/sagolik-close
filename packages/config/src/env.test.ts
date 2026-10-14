import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("environment", () => {
  it("runs locally with no configuration, in demo mode", () => {
    const env = parseEnv({});
    expect(env.demoMode).toBe(true);
    expect(env.APP_ENV).toBe("local");
  });

  it("requires a real session secret on any deployed environment", () => {
    expect(() => parseEnv({ APP_ENV: "staging", DEMO_MODE: "true" })).toThrow(/SESSION_SECRET/);
    expect(parseEnv({ APP_ENV: "staging", DEMO_MODE: "true", SESSION_SECRET: "x".repeat(32), DEMO_RESET_HOURS: "6" }).DEMO_RESET_HOURS).toBe(6);
  });

  it("refuses demo mode in production", () => {
    expect(() => parseEnv({ APP_ENV: "production", DEMO_MODE: "true", SESSION_SECRET: "x".repeat(32) })).toThrow(/Demo mode cannot run in production/);
  });

  it("uses the sandbox chain in demo mode and keeps it out of production", () => {
    expect(parseEnv({}).chainNetwork).toBe("sandbox");
    const prod = { APP_ENV: "production", SESSION_SECRET: "x".repeat(32), NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", DATA_ENCRYPTION_KEYS: "v1:x" };
    expect(parseEnv(prod).chainNetwork).toBe("off");
    for (const network of ["sandbox", "base-sepolia", "local"]) expect(() => parseEnv({ ...prod, CHAIN_NETWORK: network })).toThrow(/base or off in production/);
    expect(() => parseEnv({ ...prod, CHAIN_NETWORK: "base" })).toThrow(/CHAIN_REGISTRY_ADDRESS/);
    const live = { ...prod, CHAIN_NETWORK: "base", CHAIN_REGISTRY_ADDRESS: `0x${"ab".repeat(20)}`, CHAIN_DEAL_SALT: "s".repeat(32) };
    expect(parseEnv(live).chainNetwork).toBe("base");
    expect(() => parseEnv({ ...live, CHAIN_DEAL_SALT: "short" })).toThrow(/CHAIN_DEAL_SALT/);
    expect(() => parseEnv({ ...live, CHAIN_RECORDER_KEY: "0x1234" })).toThrow(/CHAIN_RECORDER_KEY/);
    expect(() => parseEnv({ ...live, CHAIN_RPC_URL: "http://node.example" })).toThrow(/https/);
    expect(() => parseEnv({ ...live, CHAIN_USDC_ADDRESS: `0x${"cd".repeat(20)}` })).toThrow(/only for local/);
  });

  it("takes data keys in clear or wrapped by a Key Vault key, never both", () => {
    const kek = "https://kv-core.vault.azure.net/keys/data-kek";
    expect(parseEnv({ DATA_KEYS_WRAPPED: "v1:abc", DATA_KEK_ID: kek }).DATA_KEK_ID).toBe(kek);
    expect(() => parseEnv({ DATA_KEYS_WRAPPED: "v1:abc" })).toThrow(/DATA_KEK_ID/);
    expect(() => parseEnv({ DATA_KEYS_WRAPPED: "v1:abc", DATA_KEK_ID: kek, DATA_ENCRYPTION_KEYS: "v1:x" })).toThrow(/not both/);
    expect(() => parseEnv({ DATA_KEYS_WRAPPED: "v1:abc", DATA_KEK_ID: "https://evil.example/keys/data-kek" })).toThrow(/Key Vault key id/);
  });

  it("keeps the production recording key in Key Vault", () => {
    const prod = { APP_ENV: "production", SESSION_SECRET: "x".repeat(32), NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", DATA_ENCRYPTION_KEYS: "v1:x" };
    const live = { ...prod, CHAIN_NETWORK: "base", CHAIN_REGISTRY_ADDRESS: `0x${"ab".repeat(20)}`, CHAIN_DEAL_SALT: "s".repeat(32) };
    expect(() => parseEnv({ ...live, CHAIN_RECORDER_KEY: `0x${"11".repeat(32)}` })).toThrow(/CHAIN_RECORDER_KEY_ID instead/);
    expect(parseEnv({ ...live, CHAIN_RECORDER_KEY_ID: "https://kv-core.vault.azure.net/keys/chain-recorder" }).chainNetwork).toBe("base");
    expect(() => parseEnv({ ...live, CHAIN_RECORDER_KEY_ID: "chain-recorder" })).toThrow(/Key Vault key id/);
  });

  it("connects to PostgreSQL directly only over verified TLS, with durable document storage", () => {
    const staging = { APP_ENV: "staging", DEMO_MODE: "true", SESSION_SECRET: "x".repeat(32), AZURE_STORAGE_BLOB_URL: "https://stsagolikdev.blob.core.windows.net" };
    const url = "postgres://id-web@pg-sagolik-dev.postgres.database.azure.com:5432/close?sslmode=verify-full";
    expect(parseEnv({ ...staging, DATABASE_URL: url, DATABASE_AUTH: "entra" }).DATABASE_AUTH).toBe("entra");
    expect(() => parseEnv({ ...staging, DATABASE_URL: url.replace("verify-full", "require") })).toThrow(/verify-full/);
    expect(() => parseEnv({ ...staging, DATABASE_URL: url.replace("id-web@", "id-web:secret@"), DATABASE_AUTH: "entra" })).toThrow(/no password/);
    expect(() => parseEnv({ ...staging, DATABASE_URL: url, AZURE_STORAGE_BLOB_URL: undefined })).toThrow(/AZURE_STORAGE_BLOB_URL/);
    expect(() => parseEnv({ ...staging, DATABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a" })).toThrow(/not both/);
    expect(() => parseEnv({ ...staging, DATABASE_URL: "mysql://x@y/z" })).toThrow(/postgres/);
    // Locally, plain connections to a development database are fine.
    expect(parseEnv({ DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/close" }).demoMode).toBe(true);
    // Production on PostgreSQL waits for real sign-in.
    expect(() => parseEnv({ ...staging, APP_ENV: "production", DEMO_MODE: undefined, DATA_ENCRYPTION_KEYS: "v1:x", DATABASE_URL: url })).toThrow(/Microsoft Entra/);
  });

  it("keeps Plaid sandbox keys out of production", () => {
    const prod = { APP_ENV: "production", SESSION_SECRET: "x".repeat(32), PLAID_CLIENT_ID: "id", PLAID_SECRET: "s" };
    expect(() => parseEnv(prod)).toThrow(/PLAID_ENV must be production/);
    expect(() => parseEnv({ ...prod, PLAID_ENV: "development" })).toThrow();
  });
});
