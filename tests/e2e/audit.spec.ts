import { expect, test } from "@playwright/test";
import { adminLogin } from "./helpers";

test("audit log: a panel change appears with who / what, the drawer shows the change and links to the record", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/kategoriler/yeni");
  await page.getByLabel("Kategori adı *").fill("E2E Denetim Kategorisi");
  await page.getByRole("button", { name: "Kategoriyi oluştur" }).click();
  await expect(page).toHaveURL(/\/admin\/kategoriler(\?|$)/);

  await page.goto("/admin/denetim");
  await expect(page.getByRole("heading", { name: "Denetim kayıtları" })).toBeVisible();
  await page.getByRole("tab", { name: /Katalog/ }).click();
  await page.getByPlaceholder("Kişi, işlem kodu, sipariş no veya istek no ara").fill("category.create");
  const row = page.getByRole("row").filter({ hasText: "E2E Denetim Kategorisi" }).first();
  await expect(row).toContainText("Kategori oluşturuldu");
  await row.click();

  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Kategori oluşturuldu" })).toBeVisible();
  await expect(drawer.getByText("E2E Denetim Kategorisi").first()).toBeVisible();
  await drawer.getByRole("link", { name: "Kayda git" }).click();
  await expect(page).toHaveURL(/\/admin\/kategoriler\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "E2E Denetim Kategorisi" })).toBeVisible();
});
