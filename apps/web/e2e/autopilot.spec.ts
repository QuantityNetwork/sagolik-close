import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test.describe.configure({ mode: "serial" });

test("an owner sees the exceptions first, and a review clears one", async ({ page }) => {
  await signInAs(page, "alex.morgan");
  await expect(page).toHaveURL(/\/app\/autopilot$/);
  await expect(page.getByText("Monitoring only · Sagolik never pays bills or moves money").first()).toBeVisible();
  await expect(page.getByText("2 of 5")).toBeVisible();
  await expect(page.getByText("Electricity $2,870 is 9.4× the usual amount").first()).toBeVisible();
  await expect(page.getByText("Move $1,840 from your reserve").first()).toBeVisible();
  await expect(page.getByText("Homeowners insurance $14,200 needs your review").first()).toBeVisible();

  await page.getByRole("link", { name: "Miami Beach Residence" }).first().click();
  await page.getByRole("navigation", { name: "Property sections" }).getByRole("link", { name: /Bills/ }).click();
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await page.getByRole("navigation", { name: "Property sections" }).getByRole("link", { name: /Overview/ }).click();
  await expect(page.getByText("All critical costs are covered for the next 30 days.")).toBeVisible();
});

test("a homeowner moves from closing to live monitoring", async ({ page }) => {
  await signInAs(page, "mia.rodriguez");
  await page.goto("/app/ownership");
  await page.getByRole("button", { name: "Set up Autopilot" }).click();
  await expect(page).toHaveURL(/\/app\/autopilot\/[^/]+\/live$/);
  await expect(page.getByText("Property acquired")).toBeVisible();
  await expect(page.getByText("Monitoring started.")).toBeVisible();
  await expect(page.getByText("No mortgage on this purchase.")).toBeVisible();
  await page.getByRole("link", { name: /Review \d+ items? that need you/ }).click();
  await expect(page.getByText(/costs? to confirm/).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).first().click();
  await expect(page.getByText("Monitored").first()).toBeVisible();
});

test("portfolios are private", async ({ page }) => {
  await signInAs(page, "alex.morgan");
  await page.getByRole("link", { name: "Aspen Vacation Home" }).first().click();
  await page.waitForURL(/\/app\/autopilot\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.context().clearCookies();
  await signInAs(page, "olivia.carter");
  const res = await page.goto(url);
  expect(res?.status()).toBe(404);
});
