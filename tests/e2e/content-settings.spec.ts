import { expect, test } from "@playwright/test";
import { adminLogin } from "./helpers";

test("site settings: changing the company name updates the legal texts that use {{firma.unvan}}", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/ayarlar?grup=company");
  const name = page.getByLabel("Ticari unvan");
  await name.fill("E2E Deneme Ticaret Ltd. Şti.");
  await expect(page.getByText("Bu grupta kaydedilmemiş değişiklikler var.")).toBeVisible();
  await page.getByRole("button", { name: "Güncelle" }).click();
  await expect(page.getByText("Firma bilgileri güncellendi")).toBeVisible();

  await page.goto("/sayfa/mesafeli-satis-sozlesmesi");
  await expect(page.getByRole("heading", { level: 1, name: "Mesafeli Satış Sözleşmesi" })).toBeVisible();
  await expect(page.locator("article").getByText("E2E Deneme Ticaret Ltd. Şti.").first()).toBeVisible();
  await expect(page.locator("footer").getByText(/E2E Deneme Ticaret Ltd\. Şti\./)).toBeVisible();
});

test("site settings: invalid values are rejected per field", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/ayarlar?grup=company");
  await page.getByLabel("MERSİS no").fill("12345");
  await page.getByRole("button", { name: "Güncelle" }).click();
  await expect(page.getByText("16 haneli olmalı.")).toBeVisible();
});

test("content: a published help page appears in the storefront footer automatically", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/icerik/yeni");
  await page.locator("#pg-title").fill("E2E Teslimat Bölgeleri");
  await page.locator("#pg-kind").selectOption("help");
  await page.locator("#pg-body").click();
  await page.keyboard.type("Türkiye'nin 81 iline gönderim yapıyoruz.");
  await page.locator('input[name="status"][value="published"]').check(); // "Yayında" also matches the archive hint
  await page.locator("#pg-footer").selectOption("help");
  await page.getByRole("button", { name: "Sayfayı oluştur" }).click();
  await expect(page.getByText("Sayfa kaydedildi")).toBeVisible(); // the list drops ?vurgula= from the URL right away
  await expect(page.getByText("E2E Teslimat Bölgeleri").first()).toBeVisible();

  await page.goto("/");
  const help = page.locator("footer").getByRole("navigation", { name: "Yardım" });
  await help.getByRole("link", { name: "E2E Teslimat Bölgeleri" }).click();
  await expect(page).toHaveURL(/\/sayfa\/e2e-teslimat-bolgeleri$/);
  await expect(page.getByText("81 iline gönderim")).toBeVisible();
});

test("content: a published legal text cannot be deleted (archive instead)", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/icerik");
  await page.getByRole("link", { name: "Düzenle" }).first().click();
  await expect(page.getByRole("button", { name: "Sil" })).toBeDisabled();
});
