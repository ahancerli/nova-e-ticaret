import { expect, test } from "@playwright/test";
import { adminLogin, guestCheckout } from "./helpers";

/**
 * The main money path, end to end in a real browser:
 * guest adds a product → cart drawer → cart page → checkout with bank transfer → order created →
 * staff finds it, adds a note, reconciles the transfer → order is paid.
 */
test.describe.serial("shop → admin", () => {
  let orderNumber = "";

  test("guest checkout with bank transfer", async ({ page }) => {
    orderNumber = await guestCheckout(page);
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
