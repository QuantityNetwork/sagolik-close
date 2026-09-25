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

  it("keeps Plaid sandbox keys out of production", () => {
    const prod = { APP_ENV: "production", SESSION_SECRET: "x".repeat(32), PLAID_CLIENT_ID: "id", PLAID_SECRET: "s" };
    expect(() => parseEnv(prod)).toThrow(/PLAID_ENV must be production/);
    expect(() => parseEnv({ ...prod, PLAID_ENV: "development" })).toThrow();
  });
});
