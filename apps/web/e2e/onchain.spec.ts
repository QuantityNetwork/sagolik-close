import { expect, type Page, test } from "@playwright/test";
import { completeStepUp, signInAs } from "./helpers";

test.describe.configure({ mode: "serial" });

async function openMaple(page: Page, tab: string) {
  await page.goto("/app/transactions");
  await page.getByRole("link", { name: /Maple Ridge/ }).first().click();
  await page.getByRole("navigation", { name: /transaction/i }).getByRole("link", { name: tab }).click();
}

test("buyer proves funds with a signed message from the demo wallet", async ({ page }) => {
  await signInAs(page, "olivia.carter");
  await openMaple(page, "Money");
  await page.getByRole("button", { name: "Use the demo wallet" }).click();

  // The sandbox wallet shows exactly what a wallet app would ask to sign.
  await expect(page).toHaveURL(/\/sandbox\/wallet/);
  await expect(page.getByText(/asks you to confirm you control this wallet/)).toBeVisible();
  await expect(page.getByText(/Purpose: proof of funds for closing SC-DEMO-MAPLE/)).toBeVisible();
  await expect(page.getByText(/It does not send money, approve spending/)).toBeVisible();
  await page.getByRole("button", { name: "Sign", exact: true }).click();

  await expect(page).toHaveURL(/\/money\?wallet=connected/);
  const wallets = page.locator("#wallets");
  await expect(wallets.getByText("$250,000", { exact: true })).toBeVisible();
  await expect(wallets.getByText(/Covers the \$[\d,.]+ still needed/)).toBeVisible();
  await wallets.getByRole("button", { name: "Check funds for closing" }).click();
  await expect(wallets.getByRole("alert").filter({ hasText: /went wrong|couldn't/ })).toHaveCount(0);
});

test("escrow sees the wallet result, not the balance, and records a USDC payment with evidence", async ({ page }) => {
  await signInAs(page, "marcus.lee");
  await openMaple(page, "Money");
  await expect(page.getByRole("heading", { name: "Buyer's proof of funds" })).toBeVisible();
  await expect(page.getByText(/USDC wallet on Sandbox chain \(demo\) •••• \w{4} · control proven by signature/)).toBeVisible();
  await expect(page.getByText("$250,000", { exact: true })).toHaveCount(0);

  const simulate = async () => {
    await page.getByText("Record funds from your escrow system").click();
    await page.getByRole("button", { name: /Simulate a USDC payment/ }).click();
  };
  await simulate();
  await page.getByRole("link", { name: "Confirm" }).click();
  await completeStepUp(page);
  await simulate();
  await expect(page.getByText(/the buyer's wallet sent USDC to the escrow partner/)).toBeVisible();
  await expect(page.getByText(/Funds received \(recorded by escrow\) · USDC on Sandbox chain/)).toBeVisible();
});

test("the deal record matches the chain, and money facts stay with people who handle money", async ({ page }) => {
  await signInAs(page, "marcus.lee");
  await openMaple(page, "Record");
  await expect(page.getByRole("heading", { name: "Deal record" })).toBeVisible();
  await expect(page.getByText("Deal opened")).toBeVisible();
  await expect(page.getByText(/paid in USDC \(0x\w+…\w+\) from the buyer's confirmed wallet/)).toBeVisible();
  await page.getByRole("button", { name: /Check against Sandbox chain/ }).click();
  await expect(page.getByText("The public record matches")).toBeVisible();
  const download = await page.request.get(page.url().replace(/\/record$/, "").replace("/app/transactions/", "/api/v1/transactions/") + "/deal-record");
  expect(download.status()).toBe(200);
  const exported = await download.json();
  expect(exported.format).toBe("sagolik-close/deal-record/v1");
  expect(JSON.stringify(exported)).not.toMatch(/Olivia|Carter|Daniel|Brooks|Maple Ridge Drive/);
});

test("an agent sees the record without money facts", async ({ page }) => {
  await signInAs(page, "jessica.morgan");
  await openMaple(page, "Record");
  await expect(page.getByText("Deal opened")).toBeVisible();
  await expect(page.getByText("Funds received by escrow")).toHaveCount(0);
  await expect(page.getByText("Payment instructions verified")).toHaveCount(0);
});
