import { expect, test } from "@playwright/test";
import { adminLogin } from "./helpers";

/**
 * The main money path, end to end in a real browser:
 * guest adds a product → cart drawer → cart page → checkout with bank transfer → order created →
 * staff finds it, adds a note, reconciles the transfer → order is paid.
 */
test.describe.serial("shop → admin", () => {
  let orderNumber = "";

  test("guest checkout with bank transfer", async ({ page }) => {
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
    orderNumber = (await page.locator("strong").filter({ hasText: /^NV/ }).first().textContent())?.trim() ?? "";
    expect(orderNumber).toMatch(/^NV\d{6}[A-Z2-9]{6}$/);
  });

  test("staff adds a note and reconciles the transfer", async ({ page }) => {
    test.skip(!orderNumber, "needs the order from the previous step");
    await adminLogin(page);
    await page.goto(`/admin/siparisler?q=${orderNumber}`);
    await page.getByText(orderNumber).first().click();
    await expect(page).toHaveURL(/\/admin\/siparisler\/[^/?]+$/);

    await page.getByPlaceholder(/Ekibe görünür bir not/).fill("E2E: müşteri aradı");
    await page.getByRole("button", { name: "Not ekle" }).click();
    await expect(page.getByText("Not eklendi")).toBeVisible();
    await expect(page.getByText("E2E: müşteri aradı")).toBeVisible();

    await page.getByRole("button", { name: "Havaleyi onayla" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Havaleyi onayla" });
    const expected = (await dialog.locator("b").first().textContent()) ?? "";
    await dialog.getByLabel("Gelen tutar (₺)").fill(expected.replace(/[^\d,]/g, ""));
    await dialog.getByRole("button", { name: "Ödemeyi onayla" }).click();
    await expect(page.getByText("Ödeme onaylandı")).toBeVisible();
    await expect(page.getByText("Ödendi").first()).toBeVisible();
  });
});
