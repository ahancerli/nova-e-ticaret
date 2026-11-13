import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Seeded by scripts/e2e-setup.mjs into the isolated e2e database. */
export const ADMIN = { email: "e2e-admin@nova.test", password: "E2e-browser-tests-2026" };
/** Passed to the e2e server as CRON_SECRET (playwright.config.ts) so tests can run scheduled jobs. */
export const CRON_SECRET = "e2e-cron-secret";

export async function adminLogin(page: Page, next = "") {
  await page.goto(`/admin/giris${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("E-posta").fill(ADMIN.email);
  await page.getByLabel("Parola", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).not.toHaveURL(/\/admin\/giris/);
}

/** Guest buys one atlas with bank transfer through the real shop UI; returns the order number. */
export async function guestCheckout(page: Page): Promise<string> {
  await page.goto("/urun/cocuklar-icin-dunya-atlasi");
  await page.getByRole("button", { name: "Sepete ekle" }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Çocuklar İçin Dünya Atlası")).toBeVisible();
  await drawer.getByRole("link", { name: "Sepete git" }).click();

  await expect(page).toHaveURL(/\/sepet$/);
  await expect(page.getByRole("region", { name: "Sepetteki ürünler" }).getByText("Çocuklar İçin Dünya Atlası")).toBeVisible();
  await page.getByRole("link", { name: "Alışverişi tamamla" }).click();

  await expect(page).toHaveURL(/\/odeme$/);
  await page.getByRole("button", { name: "Misafir olarak devam et" }).click();
  await page.locator("#email").fill("e2e.musteri@example.com");
  await page.locator("#phone").fill("+905551112233");
  await page.locator("#s_name").fill("Deniz Test");
  await page.locator("#s_province").fill("İstanbul");
  await page.locator("#s_district").fill("Kadıköy");
  await page.locator("#s_line1").fill("Moda Caddesi No: 1");
  await page.getByRole("radio", { name: /Havale \/ EFT/ }).check();
  await page.getByRole("checkbox", { name: /mesafeli satış sözleşmesini/ }).check();
  await page.getByRole("button", { name: "Siparişi onayla" }).click();

  await expect(page.getByRole("heading", { name: "Siparişiniz oluşturuldu" })).toBeVisible();
  return (await page.locator("strong").filter({ hasText: /^NV/ }).first().textContent())?.trim() ?? "";
}

/** Runs the outbox job once (what the scheduler does every minute) — turns order.placed into a panel notification. */
export async function runOutbox(request: APIRequestContext) {
  const res = await request.post("/api/cron/outbox", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.ok()).toBeTruthy();
}
