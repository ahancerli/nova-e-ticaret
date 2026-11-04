import { expect, test } from "@playwright/test";
import { ADMIN, adminLogin } from "./helpers";

/** Panel sign-in screens: remember-me + show password, "Parolamı unuttum" (no enumeration), invalid link, SMTP settings. */
test("login: show / hide password, remember me, forgot link", async ({ page }) => {
  await page.goto("/admin/giris");
  await expect(page.getByRole("heading", { name: /paneline hoş geldiniz/ })).toBeVisible();
  const pw = page.getByLabel("Parola", { exact: true });
  await pw.fill("gizli-deger");
  await expect(pw).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Parolayı göster" }).click();
  await expect(pw).toHaveAttribute("type", "text");
  await page.getByRole("link", { name: "Parolamı unuttum?" }).click();
  await expect(page).toHaveURL(/\/admin\/sifremi-unuttum$/);

  await page.goto("/admin/giris");
  await page.getByLabel("E-posta").fill(ADMIN.email);
  await page.getByLabel("Parola", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Beni hatırla").check();
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).not.toHaveURL(/\/admin\/giris/);
  const session = (await page.context().cookies()).find((c) => c.name.endsWith("nova_admin_session"));
  expect(session && session.expires * 1000 - Date.now()).toBeGreaterThan(6 * 24 * 3600 * 1000);
});

test("forgot password: same confirmation for known and unknown addresses; resend waits a minute", async ({ page }) => {
  for (const email of [ADMIN.email, "kimse-yok@nova.test"]) {
    await page.goto("/admin/sifremi-unuttum");
    await page.getByLabel("E-posta").fill(email);
    await page.getByRole("button", { name: "Sıfırlama bağlantısı gönder" }).click();
    await expect(page.getByRole("heading", { name: /E-postanızı kontrol edin/ })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("button", { name: /Tekrar gönder \(\d+ sn\)/ })).toBeDisabled();
  }
  await page.getByRole("link", { name: "Girişe dön" }).click();
  await expect(page).toHaveURL(/\/admin\/giris$/);
});

test("an invalid reset link offers a new one", async ({ page }) => {
  await page.goto("/admin/sifre/aaaaaaaaaaaaaaaaaaaaaaaa");
  await expect(page.getByRole("heading", { name: "Bağlantı geçersiz" })).toBeVisible();
  await page.getByRole("link", { name: "Yeni bağlantı iste" }).click();
  await expect(page).toHaveURL(/\/admin\/sifremi-unuttum$/);
});

test("SMTP settings: Gmail preset, password is write-only, audit-safe; removal", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/entegrasyonlar/e-posta");
  await expect(page.getByRole("heading", { name: "E-posta (SMTP)" })).toBeVisible();
  await page.getByRole("button", { name: "Gmail" }).click();
  await expect(page.getByLabel("SMTP sunucusu")).toHaveValue("smtp.gmail.com");
  await expect(page.getByLabel("Port")).toHaveValue("465");
  await page.getByLabel("Kullanıcı adı").fill("magaza.e2e@gmail.com");
  await expect(page.getByLabel("Gönderen e-posta")).toHaveValue("magaza.e2e@gmail.com");
  await page.getByLabel("Gönderen adı").fill("Nova E2E");
  await page.getByRole("button", { name: "E-posta hesabını ekle" }).click();
  await expect(page.getByText("SMTP parolasını girin.").first()).toBeVisible();
  await page.getByLabel("Parola").fill("abcd efgh ijkl mnop");
  await expect(page.getByLabel("Parola")).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "E-posta hesabını ekle" }).click();
  await expect(page.getByText("E-posta ayarları eklendi")).toBeVisible();
  await expect(page.getByText("Bağlı", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Parola")).toHaveValue("");
  await expect(page.getByText("Parola kayıtlı ve gösterilmez.", { exact: false })).toBeVisible();
  expect(await page.content()).not.toContain("abcd efgh");

  await page.getByRole("button", { name: "Kaldır" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Evet, kaldır" }).click();
  await expect(page.getByText("E-posta ayarları kaldırıldı")).toBeVisible();
  await expect(page.getByText("Bağlı değil")).toBeVisible();
});
