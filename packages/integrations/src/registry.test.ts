import { parseEnv } from "@sagolik/config";
import { describe, expect, it } from "vitest";
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
