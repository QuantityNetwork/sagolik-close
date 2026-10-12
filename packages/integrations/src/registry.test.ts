import { parseEnv } from "@sagolik/config";
import { describe, expect, it } from "vitest";
import { BASE_USDC, BaseChainProvider, SandboxChainProvider } from "./chain";
import { OutboxEmailProvider, OutboxSmsProvider, ResendEmailProvider } from "./notifications";
import { createProviders } from "./registry";

const base = { APP_ENV: "staging", SESSION_SECRET: "s".repeat(40), APP_URL: "https://demo.example.test", RESEND_API_KEY: "re_test", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+10000000000" };

describe("provider registry", () => {
  it("never sends transaction email or SMS to fictional people in demo mode", () => {
    const p = createProviders(parseEnv({ ...base, DEMO_MODE: "true" }));
    expect(p.email).toBeInstanceOf(OutboxEmailProvider);
    expect(p.sms).toBeInstanceOf(OutboxSmsProvider);
    // …but contact-form enquiries still reach the real team.
    expect(p.contactEmail).toBeInstanceOf(ResendEmailProvider);
  });

  it("uses configured providers outside demo mode", () => {
    const p = createProviders(parseEnv({ ...base, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }));
    expect(p.email).toBeInstanceOf(ResendEmailProvider);
    expect(p.contactEmail).toBe(p.email);
  });

  it("uses the sandbox chain in demo mode, no chain by default otherwise, and Base when configured", () => {
    expect(createProviders(parseEnv({ ...base, DEMO_MODE: "true" })).chain).toBeInstanceOf(SandboxChainProvider);
    const real = { ...base, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };
    expect(createProviders(parseEnv(real)).chain).toBeNull();
    const chain = createProviders(parseEnv({ ...real, CHAIN_NETWORK: "base-sepolia", CHAIN_REGISTRY_ADDRESS: `0x${"ab".repeat(20)}`, CHAIN_DEAL_SALT: "s".repeat(32) })).chain;
    expect(chain).toBeInstanceOf(BaseChainProvider);
    // No recording key: everything but writing records works.
    expect(chain!.info).toMatchObject({ network: "base-sepolia", chainId: 84532, usdc: BASE_USDC["base-sepolia"], canRecord: false });
    expect(chain!.txUrl(`0x${"1".repeat(64)}`)).toBe(`https://sepolia.basescan.org/tx/0x${"1".repeat(64)}`);
  });

  it("refuses sandbox adapters for regulated functions in production", () => {
    const env = parseEnv({
      ...base,
      APP_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      DATA_ENCRYPTION_KEYS: "v1:bG9jYWwtZGV2LWtleS1ub3QtZm9yLXByb2QtdXNlISE=",
      SESSION_SECRET: "x".repeat(40),
    });
    expect(() => createProviders(env)).toThrow(/Production requires real providers/);
  });
});
