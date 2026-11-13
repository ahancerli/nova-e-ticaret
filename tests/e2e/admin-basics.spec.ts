import { expect, test } from "@playwright/test";
import { ADMIN, adminLogin } from "./helpers";

test("admin pages require a session; wrong password gives one generic error", async ({ page }) => {
  await page.goto("/admin/siparisler");
  await expect(page).toHaveURL(/\/admin\/giris/);
  await page.getByLabel("E-posta").fill(ADMIN.email);
  await page.getByLabel("Parola", { exact: true }).fill("definitely-wrong");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "E-posta veya parola hatalı." })).toBeVisible();
});

test("create a category (Turkish slug) and see it highlighted in the tree", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/kategoriler/yeni");
  await page.getByLabel("Kategori adı *").fill("E2E Bahçe Ürünleri");
  await page.getByRole("button", { name: "Kategoriyi oluştur" }).click();
  await expect(page).toHaveURL(/\/admin\/kategoriler(\?|$)/);
  await expect(page.getByText("E2E Bahçe Ürünleri").first()).toBeVisible();
  await expect(page.getByText("e2e-bahce-urunleri").first()).toBeVisible();
});

test("unknown order shows the in-shell not-found page", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/siparisler/boyle-bir-siparis-yok");
  await expect(page.getByRole("heading", { name: "Kayıt bulunamadı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Panele dön" })).toBeVisible();
});

test("expired session during an action → back to login with a return address", async ({ page, context }) => {
  await adminLogin(page);
  await page.goto("/admin/siparisler/ord_demo_1");
  await expect(page.getByRole("button", { name: "Not ekle" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // the bell's first poll would otherwise hit the 401 and redirect before the click
  await context.clearCookies(); // the session ends while the page is open
  await page.getByPlaceholder(/Ekibe görünür bir not/).fill("oturum yok");
  await page.getByRole("button", { name: "Not ekle" }).click();
  await expect(page.getByText("Oturumunuzun süresi doldu")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/giris\?next=%2Fadmin%2Fsiparisler%2Ford_demo_1/);
});

test("dashboard: period switch and work queue link into the filtered order list", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(Günaydın|İyi günler|İyi akşamlar|İyi geceler)/);
  await expect(page.getByText("Son 30 gün ·")).toBeVisible();
  await page.getByRole("navigation", { name: "Dönem" }).getByRole("link", { name: "7 gün" }).click();
  await expect(page).toHaveURL(/\/admin\?donem=7g$/);
  await expect(page.getByText("Son 7 gün ·")).toBeVisible();
  await page.getByRole("link", { name: /Havale onayı bekliyor/ }).click();
  await expect(page).toHaveURL(/\/admin\/siparisler\?sekme=waiting$/);
  await expect(page.getByRole("tab", { name: /Ödeme bekleyen/ })).toHaveAttribute("aria-selected", "true");
});
