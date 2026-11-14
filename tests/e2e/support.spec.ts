import { expect, test } from "@playwright/test";
import { adminLogin } from "./helpers";

const SHOTS = process.env.SUPPORT_SHOTS_DIR;

test("live support: admin switches it on, visitor is asked to sign in, member and agent chat live both ways", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await adminLogin(admin, "/admin/canli-destek");
  await admin.goto("/admin/canli-destek");
  await expect(admin.getByText(/Canlı destek kapalı/)).toBeVisible();
  await admin.getByRole("button", { name: "Canlı desteği aç" }).click();
  await admin.getByRole("switch", { name: /Canlı destek açık/ }).check();
  await admin.getByRole("button", { name: "Güncelle" }).click();
  await expect(admin.getByText(/Canlı destek kapalı/)).toBeHidden();

  const shop = await (await browser.newContext()).newPage();
  await shop.goto("/");
  await shop.getByRole("button", { name: "Bize ulaşın" }).click();
  await expect(shop.getByText("Yazışmak için giriş yapın")).toBeVisible();

  await shop.goto("/uye-ol");
  await shop.locator("#firstName").fill("Ece");
  await shop.locator("#lastName").fill("Yılmaz");
  await shop.locator("#email").fill(`destek.${Date.now()}@example.com`);
  await shop.locator("#password").fill("Mavi-Gokyuzu-2026");
  await shop.getByRole("checkbox", { name: /KVKK aydınlatma/ }).check();
  await shop.getByRole("button", { name: "Üye ol" }).click();
  await expect(shop).toHaveURL(/\/hesabim/);

  await shop.getByRole("button", { name: "Bize ulaşın" }).click();
  await expect(shop.getByText("Temsilcimiz çevrimiçi")).toBeVisible(); // the support page holds the agent's stream
  await shop.getByLabel("Mesajınız").fill("Merhaba, kargom nerede?");
  await shop.keyboard.press("Enter");
  await expect(shop.getByText("Merhaba, kargom nerede?")).toBeVisible();

  const row = admin.getByRole("button", { name: /Ece Yılmaz/ });
  await expect(row.getByLabel("1 okunmamış")).toBeVisible();
  await row.click();
  await expect(admin.getByText("Merhaba, kargom nerede?").last()).toBeVisible();
  await expect(row.getByLabel("1 okunmamış")).toBeHidden();

  await shop.getByLabel("Mesajınız").fill("Sipariş no 1234");
  await expect(admin.getByLabel("Müşteri yazıyor")).toBeVisible();
  await shop.keyboard.press("Enter");

  await admin.getByLabel("Yanıtınız").fill("Merhaba Ece, hemen bakıyorum.");
  await admin.keyboard.press("Enter");
  await expect(shop.getByText("Merhaba Ece, hemen bakıyorum.")).toBeVisible();
  await expect(admin.getByText("Görüldü")).toBeVisible();
  if (SHOTS) {
    await shop.screenshot({ path: `${SHOTS}/shop-open.png` });
    await admin.screenshot({ path: `${SHOTS}/admin-page.png` });
  }

  await shop.getByRole("button", { name: "Kapat" }).click();
  await admin.getByLabel("Yanıtınız").fill("Kargonuz yolda, yarın teslim edilecek.");
  await admin.keyboard.press("Enter");
  await expect(shop.getByRole("button", { name: /1 okunmamış mesaj/ })).toBeVisible();

  // after a reload the badge comes from the server (SSR), not from memory
  await shop.reload();
  await expect(shop.getByRole("button", { name: /1 okunmamış mesaj/ })).toBeVisible();
  await shop.getByRole("button", { name: /Bize ulaşın/ }).click();
  await expect(shop.getByText("Kargonuz yolda, yarın teslim edilecek.")).toBeVisible();
  await expect(shop.getByRole("button", { name: /okunmamış/ })).toHaveCount(0);

  // the dock on any other admin page carries the live count
  await admin.goto("/admin/bildirimler");
  await shop.getByLabel("Mesajınız").fill("Teşekkürler!");
  await shop.keyboard.press("Enter");
  const dock = admin.getByRole("button", { name: /Canlı destek, 1 okunmamış mesaj/ });
  await expect(dock).toBeVisible();
  await dock.click();
  if (SHOTS) {
    await admin.getByRole("dialog", { name: "Canlı destek" }).getByRole("button", { name: /Ece Yılmaz/ }).click();
    await admin.screenshot({ path: `${SHOTS}/admin-dock.png` });
    await shop.setViewportSize({ width: 390, height: 780 });
    await shop.screenshot({ path: `${SHOTS}/shop-mobile.png` });
  }
});
