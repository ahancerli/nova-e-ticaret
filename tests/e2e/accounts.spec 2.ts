import { expect, test } from "@playwright/test";
import { adminLogin } from "./helpers";

test("storefront sign-up → signed in → listed under admin Müşteriler with the consent", async ({ page, context }) => {
  const email = `uye.${Date.now()}@example.com`;
  await page.goto("/uye-ol");
  await page.locator("#firstName").fill("Selin");
  await page.locator("#lastName").fill("Aydın");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("Mavi-Gokyuzu-2026");
  await page.getByRole("checkbox", { name: /KVKK aydınlatma/ }).check();
  await page.getByRole("checkbox", { name: /E-posta ile ticari/ }).check();
  await page.getByRole("button", { name: "Üye ol" }).click();
  await expect(page).toHaveURL(/\/hesabim/);
  await expect(page.getByText(email)).toBeVisible();

  await context.clearCookies();
  await adminLogin(page);
  await page.goto("/admin/musteriler");
  await page.getByPlaceholder("Ad, e-posta veya telefon ara").fill("aydın");
  await page.getByText(email).click();
  await expect(page.getByRole("heading", { name: "Selin Aydın" })).toBeVisible();
  await expect(page.getByText("E-posta ile ticari ileti")).toBeVisible();
});

test("invite a panel user → they set their own password → panel sign-in; storefront refuses the staff account", async ({ page, browser }) => {
  const email = `ekip.${Date.now()}@nova.test`;
  await adminLogin(page);
  await page.goto("/admin/kullanicilar");
  await page.getByRole("button", { name: "Kullanıcı davet et" }).click();
  await page.locator("#inv-name").fill("Ahmet Depocu");
  await page.locator("#inv-email").fill(email);
  await page.getByRole("checkbox", { name: /Sipariş Yöneticisi/ }).check();
  await page.getByRole("button", { name: "Davet bağlantısı oluştur" }).click();
  const link = await page.locator("#one-time-link").inputValue();
  expect(link).toMatch(/\/admin\/sifre\/[A-Za-z0-9_-]{20,}$/);

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(link);
  await expect(invitee.getByRole("heading", { name: "Hoş geldiniz, Ahmet" })).toBeVisible();
  await invitee.locator("#new-password").fill("Yesil-Yaprak-55");
  await invitee.locator("#confirm-password").fill("Yesil-Yaprak-55");
  await invitee.getByRole("button", { name: "Hesabımı etkinleştir" }).click();
  await invitee.getByRole("link", { name: "Giriş sayfasına git" }).click();
  await expect(invitee.getByLabel("E-posta")).toHaveValue(email);
  await invitee.getByLabel("Parola").fill("Yesil-Yaprak-55");
  await invitee.getByRole("button", { name: "Giriş yap" }).click();
  await expect(invitee).toHaveURL(/\/admin$/);

  await invitee.goto(link); // single use
  await expect(invitee.getByRole("heading", { name: "Bağlantı geçersiz" })).toBeVisible();

  await invitee.context().clearCookies();
  await invitee.goto("/giris");
  await invitee.getByLabel("E-posta").fill(email);
  await invitee.getByLabel("Parola").fill("Yesil-Yaprak-55");
  await invitee.getByRole("button", { name: "Giriş yap" }).click();
  await expect(invitee.getByRole("alert").filter({ hasText: "E-posta veya parola hatalı." })).toBeVisible();
});
