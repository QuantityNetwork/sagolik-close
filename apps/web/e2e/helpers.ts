import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** Seeded demo TOTP secret (fictional users only). */
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export function totp(secret = DEMO_TOTP_SECRET, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export async function signInAs(page: Page, persona: string) {
  await page.goto("/sign-in");
  await page.getByTestId(`persona-${persona}`).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

export async function completeStepUp(page: Page) {
  await expect(page).toHaveURL(/\/step-up/);
  await page.locator("#code").fill(totp());
  await page.locator("form:has(#code) button[type=submit]").click();
  await expect(page).not.toHaveURL(/\/step-up/);
}
