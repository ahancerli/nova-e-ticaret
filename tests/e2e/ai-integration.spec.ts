import { expect, test } from "@playwright/test";
import { adminLogin } from "./helpers";

test("AI integration: choose Claude with a key → the product editor offers “AI ile ürün ekle” with field choices", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/entegrasyonlar/ai");
  await expect(page.getByRole("heading", { name: "AI entegrasyonları" })).toBeVisible();
  await page.getByRole("radio", { name: /Claude/ }).click();
  await page.getByLabel("Model").fill("claude-sonnet-5-5");
  await page.getByLabel("API anahtarı").fill("sk-ant-e2e-0000000000000000000000000000");
  await page.getByRole("button", { name: "Entegrasyonu ekle" }).click();
  await expect(page.getByText("AI entegrasyonu eklendi")).toBeVisible();
  await expect(page.getByText("Bağlı", { exact: true })).toBeVisible();
  await expect(page.getByText("…0000", { exact: true })).toBeVisible();

  await page.goto("/admin/urunler/yeni");
  await page.getByRole("button", { name: "AI ile ürün ekle" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Claude ile çalışır", { exact: false })).toBeVisible();
  await expect(drawer.getByRole("checkbox", { name: /Ürün adı/ })).toBeChecked();
  await expect(drawer.getByRole("checkbox", { name: /SEO/ })).not.toBeChecked();
  await drawer.getByRole("button", { name: "AI ile oluştur" }).click();
  await expect(drawer.getByText("En az bir ürün görseli yükleyin.")).toBeVisible();
});
