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
