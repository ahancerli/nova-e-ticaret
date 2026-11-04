import { expect, type Page } from "@playwright/test";

/** Seeded by scripts/e2e-setup.mjs into the isolated e2e database. */
export const ADMIN = { email: "e2e-admin@nova.test", password: "E2e-browser-tests-2026" };

export async function adminLogin(page: Page, next = "") {
  await page.goto(`/admin/giris${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("E-posta").fill(ADMIN.email);
  await page.getByLabel("Parola", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).not.toHaveURL(/\/admin\/giris/);
}
