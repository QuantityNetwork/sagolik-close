import { expect, test } from "@playwright/test";

test("landing page presents the product and working calls to action", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ownership");
  for (const href of ["/sign-in", "/contact"]) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
});

test("contact form validates and confirms", async ({ page }) => {
  await page.goto("/contact?topic=sales");
  await page.fill("#name", "Test Person");
  await page.fill("#email", "test@example.com");
  await page.fill("#message", "We run a small brokerage and would like a demo.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("your message has reached our team")).toBeVisible();
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBeTruthy();
});

test("pages run their scripts under the nonce-based CSP", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  for (const path of ["/", "/contact", "/legal/privacy", "/sign-in"]) {
    await page.goto(path, { waitUntil: "networkidle" });
  }
  expect(violations).toEqual([]);
});

test("business beta page is labelled as a beta and marks its illustration", async ({ page }) => {
  await page.goto("/business");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Beta", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Illustration with fictional demo data.").first()).toBeVisible();
  await expect(page.locator('a[href="/business"]').first()).toBeAttached();
});
