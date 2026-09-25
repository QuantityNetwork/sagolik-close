import { expect, test } from "@playwright/test";
import { completeStepUp, signInAs } from "./helpers";

test.describe.configure({ mode: "serial" });

test("buyer signs the Closing Disclosure through the signature provider", async ({ page }) => {
  await signInAs(page, "olivia.carter");
  await expect(page.getByText("Review and sign Closing Disclosure")).toBeVisible();

  // Signing is a step-up action: the first attempt asks the buyer to confirm it's them.
  await page.getByRole("button", { name: /Review & Sign/ }).click();
  await page.getByRole("link", { name: "Confirm" }).click();
  await completeStepUp(page);

  await page.getByRole("button", { name: /Review & Sign/ }).click();
  await expect(page).toHaveURL(/\/sandbox\/sign/);
  await expect(page.getByText("Closing Disclosure")).toBeVisible();
  await page.getByRole("button", { name: "Sign", exact: true }).click();

  // Completion arrives by signed webhook; the workspace moves to the next step.
  await expect(page).toHaveURL(/\/documents\?signed=1/);
  await page.goto("/app");
  await expect(page.getByText("Send closing funds to escrow")).toBeVisible();
});

test("roles only see what they are allowed to", async ({ page }) => {
  await signInAs(page, "olivia.carter");
  await page.goto("/app/transactions");
  await page.getByRole("link", { name: /Maple Ridge/ }).first().click();
  const tabs = page.getByRole("navigation", { name: /transaction/i });
  await expect(tabs.getByRole("link", { name: "Money" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Audit" })).toHaveCount(0);
  const auditUrl = `${page.url().replace(/\/$/, "")}/audit`;
  const res = await page.goto(auditUrl);
  expect(res?.status()).toBe(404);
});

test("the assistant explains but refuses to act", async ({ page }) => {
  await signInAs(page, "olivia.carter");
  await page.getByPlaceholder("e.g. What is holding up my closing?").fill("Send the wire to escrow now");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/can't|cannot/i).first()).toBeVisible();
});

test("buyer sees full wire details only after confirming it's them", async ({ page }) => {
  await signInAs(page, "olivia.carter");
  await page.goto("/app/transactions");
  await page.getByRole("link", { name: /Maple Ridge/ }).first().click();
  await page.getByRole("navigation", { name: /transaction/i }).getByRole("link", { name: "Money" }).click();
  await expect(page.getByText("•••• 6789")).toBeVisible();
  await expect(page.getByText(/\d{6,}6789/)).toHaveCount(0);

  await page.getByRole("button", { name: /Show full wire details/ }).click();
  await page.getByRole("link", { name: "Confirm" }).click();
  await completeStepUp(page);
  await page.getByRole("button", { name: /Show full wire details/ }).click();
  await expect(page.getByText("Before you send")).toBeVisible();
  await expect(page.getByText(/^\d{8,17}$/).filter({ hasText: /6789$/ })).toBeVisible();
  await page.getByRole("button", { name: /Hide details/ }).click();
  await expect(page.getByText(/^\d{8,17}$/).filter({ hasText: /6789$/ })).toHaveCount(0);
});

test("escrow officer records funds received from their escrow system", async ({ page }) => {
  await signInAs(page, "marcus.lee");
  await page.goto("/app/transactions");
  await page.getByRole("link", { name: /Maple Ridge/ }).first().click();
  await page.getByRole("navigation", { name: /transaction/i }).getByRole("link", { name: "Money" }).click();
  await page.getByText("Record funds from your escrow system").click();
  await page.fill("#amount", "1,000.00");
  await page.fill("#mref", "Wire FW-E2E-1");
  await page.locator("form:has(#mref) button[type=submit]").click();
  await page.getByRole("link", { name: "Confirm" }).click();
  await completeStepUp(page);
  await page.getByText("Record funds from your escrow system").click();
  await page.fill("#amount", "1,000.00");
  await page.fill("#mref", "Wire FW-E2E-1");
  await page.locator("form:has(#mref) button[type=submit]").click();
  await expect(page.getByText("Funds received recorded.")).toBeVisible();
  await expect(page.getByText("Funds received (recorded by escrow)")).toBeVisible();
});

test("business buyer sees the acquisition with deal milestones", async ({ page }) => {
  await signInAs(page, "amara.okafor");
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1, name: "Blue Harbor Coffee" })).toBeVisible();
  await expect(page.getByText("LOI signed").first()).toBeVisible();
  await page.getByRole("link", { name: "View all" }).first().click();
  await expect(page.getByText("Business acquisition (beta)").first()).toBeVisible();
});
