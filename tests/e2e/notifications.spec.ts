import { expect, test, type Page } from "@playwright/test";
import { adminLogin, guestCheckout, runOutbox } from "./helpers";

/**
 * Top-bar bell while staff browse the panel: new orders arrive in the background, the badge count changes
 * (poll / tab focus) and the button must keep exactly one bell icon and one badge.
 */
const bell = (page: Page) => page.getByRole("button", { name: /^Bildirimler/ });

/** What the minute poll does — without waiting a minute. */
const pollBell = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("nova:notifications-changed")));

async function expectSingleBell(page: Page, unread: number) {
  const button = bell(page);
  await expect(button).toHaveAccessibleName(unread ? `Bildirimler, ${unread} okunmamış` : "Bildirimler");
  await expect(button.locator("svg.lucide-bell")).toHaveCount(1);
  await expect(button.locator("span")).toHaveCount(unread ? 1 : 0);
  if (unread) await expect(button.locator("span")).toHaveText(unread > 99 ? "99+" : String(unread));
}

const unreadOf = async (page: Page) => Number((await bell(page).getAttribute("aria-label"))?.match(/(\d+) okunmamış/)?.[1] ?? 0);

test("bell keeps a single icon while orders arrive and staff browse the panel", async ({ page, browser, request }) => {
  await adminLogin(page, "/admin");
  await expect(bell(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(bell(page).locator("svg.lucide-bell")).toHaveCount(1);
  let unread = await unreadOf(page);

  const shop = await (await browser.newContext()).newPage();
  for (const [href, label] of [["/admin/siparisler", "Siparişler"], ["/admin", "Dashboard"], ["/admin/siparisler", "Siparişler"]] as const) {
    await guestCheckout(shop);
    await runOutbox(request);
    await pollBell(page);
    unread += 1;
    await expectSingleBell(page, unread);

    // client-side navigation keeps the shell (and the bell) mounted
    await page.getByRole("navigation", { name: "Yönetim menüsü" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await pollBell(page);
    await expectSingleBell(page, unread);
  }

  await bell(page).click();
  await page.getByRole("button", { name: "Tümünü okundu say" }).click();
  await expectSingleBell(page, 0);
  await pollBell(page);
  await expectSingleBell(page, 0);
});
