import { describe, expect, it } from "vitest";
import {
  assessRisk,
  checkRateLimit,
  checkUpload,
  decryptField,
  encryptField,
  isSameOrigin,
  safeRedirectPath,
  maskAccount,
  MemoryRateLimitStore,
  MockVirusScanner,
  parseKeyRing,
  redact,
  sanitizeFilename,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./index";

const SECRET = "whsec_test";

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "payment.settled" });
  const now = 1_750_000_000;

  it("accepts a valid signature", () => {
    const header = signWebhookPayload(body, SECRET, now);
    expect(verifyWebhookSignature({ rawBody: body, header, secret: SECRET, nowSec: now + 10 })).toEqual({ ok: true, timestamp: now });
  });
  it("rejects a tampered body", () => {
    const header = signWebhookPayload(body, SECRET, now);
    const r = verifyWebhookSignature({ rawBody: body.replace("settled", "failed"), header, secret: SECRET, nowSec: now });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("rejects a replayed (stale) webhook", () => {
    const header = signWebhookPayload(body, SECRET, now);
    const r = verifyWebhookSignature({ rawBody: body, header, secret: SECRET, nowSec: now + 3600 });
    expect(r).toEqual({ ok: false, reason: "timestamp_out_of_range" });
  });
  it("rejects wrong secrets and malformed headers", () => {
    const header = signWebhookPayload(body, "other", now);
    expect(verifyWebhookSignature({ rawBody: body, header, secret: SECRET, nowSec: now }).ok).toBe(false);
    expect(verifyWebhookSignature({ rawBody: body, header: "garbage", secret: SECRET, nowSec: now })).toEqual({ ok: false, reason: "malformed_header" });
    expect(verifyWebhookSignature({ rawBody: body, header: null, secret: SECRET, nowSec: now })).toEqual({ ok: false, reason: "missing_header" });
  });
});

describe("field encryption", () => {
  const ring = parseKeyRing("v2:" + Buffer.alloc(32, 2).toString("base64") + ",v1:" + Buffer.alloc(32, 1).toString("base64"));
  it("round-trips and uses the current key", () => {
    const c = encryptField("000123456789", ring, "bank_instructions");
    expect(c.startsWith("v2.")).toBe(true);
    expect(c).not.toContain("000123456789");
    expect(decryptField(c, ring, "bank_instructions")).toBe("000123456789");
  });
  it("fails on tampering or wrong AAD", () => {
    const c = encryptField("secret", ring, "a");
    expect(() => decryptField(c, ring, "b")).toThrow();
    const parts = c.split(".");
    parts[3] = Buffer.from("xxxxxx").toString("base64url");
    expect(() => decryptField(parts.join("."), ring, "a")).toThrow();
  });
  it("decrypts values written with an older key version", () => {
    const old = parseKeyRing("v1:" + Buffer.alloc(32, 1).toString("base64"));
    const c = encryptField("legacy", old);
    expect(decryptField(c, ring)).toBe("legacy");
  });
  it("rejects short keys", () => {
    expect(() => parseKeyRing("v1:" + Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

describe("masking & redaction", () => {
  it("masks accounts", () => expect(maskAccount("4821")).toBe("•••• 4821"));
  it("redacts sensitive keys deeply", () => {
    const r = redact({ access_token: "abc", nested: { accountNumber: "123", ok: 1 }, list: [{ apiKey: "k" }] });
    expect(r).toEqual({ access_token: "[REDACTED]", nested: { accountNumber: "[REDACTED]", ok: 1 }, list: [{ apiKey: "[REDACTED]" }] });
  });
});

describe("uploads (malicious upload defence)", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
  it("accepts a plain PDF regardless of claimed name", () => {
    const r = checkUpload(pdf, "../../etc/passwd.pdf");
    expect(r.ok && r.mime).toBe("application/pdf");
    expect(r.ok && r.safeName).toBe("passwd.pdf");
  });
  it("rejects executables disguised as PDFs", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]);
    expect(checkUpload(exe, "statement.pdf")).toEqual({ ok: false, reason: "unsupported_type" });
  });
  it("rejects PDFs with embedded JavaScript", () => {
    const evil = new TextEncoder().encode("%PDF-1.7\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>");
    expect(checkUpload(evil, "x.pdf")).toEqual({ ok: false, reason: "active_content" });
  });
  it("rejects empty files", () => expect(checkUpload(new Uint8Array(), "a.pdf")).toEqual({ ok: false, reason: "empty" }));
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("<script>alert(1)</script>.pdf")).toBe("script_.pdf");
    expect(sanitizeFilename("in<voice>.pdf")).toBe("in_voice_.pdf");
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });
  it("mock scanner flags EICAR", async () => {
    const eicar = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect((await new MockVirusScanner().scan(eicar)).clean).toBe(false);
    expect((await new MockVirusScanner().scan(pdf)).clean).toBe(true);
  });
});

describe("rate limiting", () => {
  it("blocks after the limit within a window and resets after", async () => {
    const store = new MemoryRateLimitStore();
    const policy = { limit: 3, windowMs: 1000 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(store, "ip:1", policy, 0));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect((await checkRateLimit(store, "ip:1", policy, 1001)).allowed).toBe(true);
    // Separate keys are independent (no cross-user bleed).
    expect((await checkRateLimit(store, "ip:2", policy, 0)).allowed).toBe(true);
  });
});

describe("fraud rules", () => {
  it("treats bank instruction changes as high risk with full controls", () => {
    const r = assessRisk({ kind: "bank_instruction_changed", hoursToClosing: 500 });
    expect(r.level).toBe("high");
    expect(r.controls).toEqual(expect.arrayContaining(["step_up", "dual_approval", "out_of_band_verification", "cooling_off"]));
    expect(r.coolingOffHours).toBe(24);
  });
  it("escalates last-minute changes to critical", () => {
    const r = assessRisk({ kind: "bank_instruction_changed", hoursToClosing: 12 });
    expect(r.level).toBe("critical");
    expect(r.controls).toContain("manual_review");
    expect(r.coolingOffHours).toBe(48);
  });
  it("compounds new-device signals", () => {
    expect(assessRisk({ kind: "unusual_login_geography", deviceAgeHours: 2 }).level).toBe("high");
  });
});

describe("CSRF origin check", () => {
  it("requires same origin", () => {
    expect(isSameOrigin("https://close.sagolik.com/api/v1/x", "https://close.sagolik.com", null)).toBe(true);
    expect(isSameOrigin("https://close.sagolik.com/api/v1/x", "https://evil.example", null)).toBe(false);
    expect(isSameOrigin("https://close.sagolik.com/api/v1/x", null, null)).toBe(false);
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "/ok\\..", "/a\u0000b", "", null]) expect(safeRedirectPath(bad, "/app")).toBe("/app");
    expect(safeRedirectPath("/app/transactions/1?x=2#y")).toBe("/app/transactions/1?x=2#y");
    // Behind a proxy the request URL is internal; the configured public origin is what the browser sends.
    expect(isSameOrigin(["http://0.0.0.0:3000/api/v1/x", "https://close.sagolik.com"], "https://close.sagolik.com", null)).toBe(true);
    expect(isSameOrigin(["http://0.0.0.0:3000/api/v1/x", "https://close.sagolik.com"], "https://evil.example", null)).toBe(false);
  });
});
