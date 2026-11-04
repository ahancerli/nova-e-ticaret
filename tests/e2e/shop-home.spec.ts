import { expect, test } from "@playwright/test";

/**
 * Storefront micro-frontend (src/features/shop): SSR home / header / footer, mega menu, GraphQL search
 * suggestions and listing filters, add to cart from a product card, mobile drill-down menu.
 */
test("home is server-rendered: sections, category menu and footer are in the HTML", async ({ request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("Popüler ürünlerden seçtik");
  expect(html).toContain('aria-label="Kategoriler"');
  expect(html).toContain("/kategori/erkek-kazak"); // mega menu grandchild, no JS needed
  expect(html).toContain("Aklınıza takılan bir soru mu var?");
});

test("add to cart from a home product card opens the drawer and counts the item", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByRole("region", { name: "Popüler ürünlerden seçtik" });
  const card = rail.getByRole("article").filter({ hasText: "Sound Studio" }).first();
  await card.hover();
  await card.getByRole("button", { name: /sepete ekle$/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/Mini Kablosuz Hoparlör/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sepetim, 1 ürün" })).toBeAttached();
});

test("cart drawer → cart page: greet the added item, change quantity, remove until empty", async ({ page }) => {
  await page.goto("/urun/cocuklar-icin-dunya-atlasi");
  await page.getByRole("button", { name: "Sepete ekle" }).click();
  const drawer = page.getByRole("dialog", { name: /Sepetim/ });
  await expect(drawer.getByText("Ürün sepetinize eklendi")).toBeVisible();
  await expect(drawer.getByText("Yeni eklendi")).toBeVisible();
  await drawer.getByRole("link", { name: "Sepete git" }).click();
  await expect(page).toHaveURL(/\/sepet$/);
  await expect(drawer).toBeHidden();

  const lines = page.getByRole("region", { name: "Sepetteki ürünler" });
  await lines.getByRole("button", { name: /Dünya Atlası adedini artır/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("(2 ürün)");
  await lines.getByRole("button", { name: /Dünya Atlası ürününü kaldır/ }).click();
  await expect(page.getByRole("heading", { name: "Sepetiniz boş" })).toBeVisible();
});

test("phone: cart drawer is a full-width sheet and closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/urun/cocuklar-icin-dunya-atlasi");
  await page.getByRole("button", { name: "Sepete ekle" }).first().click();
  const drawer = page.getByRole("dialog", { name: /Sepetim/ });
  await expect(drawer.getByRole("link", { name: "Sepete git" })).toBeVisible();
  const box = await drawer.boundingBox();
  expect(Math.round(box!.width)).toBe(390);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.goto("/sepet");
  await expect(page.getByRole("link", { name: "Alışverişi tamamla" })).toBeVisible(); // sticky bottom bar on phones
  await page.getByRole("button", { name: /Dünya Atlası ürününü kaldır/ }).click();
  await expect(page.getByRole("heading", { name: "Sepetiniz boş" })).toBeVisible();
});

test("mega menu opens on hover and leads into a subcategory listing", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Kategoriler" });
  await nav.getByRole("link", { name: "Moda", exact: true }).hover();
  await expect(nav.getByRole("link", { name: "Erkek" })).toBeVisible();
  await nav.getByRole("link", { name: "Kazak" }).click();
  await expect(page).toHaveURL(/\/kategori\/erkek-kazak$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("search suggestions come from GraphQL and link to the product", async ({ page }) => {
  await page.goto("/");
  const graph = page.waitForResponse((r) => r.url().endsWith("/api/graphql") && r.request().method() === "POST");
  await page.getByRole("combobox", { name: /Ürün, kategori veya marka ara/ }).first().fill("atlas");
  expect((await graph).status()).toBe(200);
  await page.getByRole("list", { name: "Ürün önerileri" }).getByRole("link", { name: /Dünya Atlası/ }).click();
  await expect(page).toHaveURL(/\/urun\/cocuklar-icin-dunya-atlasi$/);
});

test("listing filters update the URL and refetch through one GraphQL request (no page reload)", async ({ page }) => {
  await page.goto("/ara?q=a");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("için sonuçlar");
  const before = await page.getByRole("article").count();
  expect(before).toBeGreaterThan(0);
  let documentRequests = 0;
  page.on("request", (r) => { if (r.resourceType() === "document") documentRequests++; });
  const graph = page.waitForResponse((r) => r.url().endsWith("/api/graphql"));
  await page.getByLabel("Sıralama").selectOption("price_desc");
  await graph;
  await expect(page).toHaveURL(/sort=price_desc/);
  const prices = await page.getByRole("article").locator("p.font-bold").allTextContents();
  const nums = prices.map((p) => Number(p.replace(/[^\d,]/g, "").replace(",", ".")));
  expect(nums).toEqual([...nums].sort((a, b) => b - a));
  expect(documentRequests).toBe(0);
  await page.goBack();
  await expect(page).not.toHaveURL(/sort=/);
});

test("listing: sidebar filter → removable chip; brand shortcut chip; phone bottom sheet shows the live count", async ({ page }) => {
  await page.goto("/kampanyalar");
  const sidebar = page.getByRole("complementary", { name: "Filtreler" });
  const all = await page.getByRole("article").count();
  const black = sidebar.getByRole("checkbox", { name: /Siyah/ });
  await black.click(); // URL-driven state settles on the next frame (pushState → useSearchParams)
  await expect(black).toBeChecked();
  await expect(page).toHaveURL(/a\.color=black/);
  const chips = page.getByRole("list", { name: "Seçili filtreler" });
  await expect(chips.getByRole("button", { name: /Renk: Siyah filtresini kaldır/ })).toBeVisible();
  await expect.poll(() => page.getByRole("article").count()).toBeLessThan(all);
  await chips.getByRole("button", { name: /filtresini kaldır/ }).click();
  await expect(page).not.toHaveURL(/a\.color/);

  await page.getByRole("list", { name: "Marka kısayolları" }).getByRole("button", { name: "Atelier" }).click();
  await expect(page).toHaveURL(/brand=atelier/);
  await expect(page.getByRole("article")).toHaveCount(1);
  await chips.getByRole("button", { name: "Tümünü temizle" }).click();
  await expect(page).not.toHaveURL(/brand=/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Filtrele/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filtreler" });
  await sheet.getByText("Sadece stoktakiler").click();
  await expect(sheet.getByRole("switch", { name: "Sadece stoktakiler" })).toBeChecked();
  await expect(page).toHaveURL(/inStock=1/);
  await expect(sheet.getByRole("button", { name: /ürünü göster$/ })).toBeVisible();
  await sheet.getByRole("button", { name: /ürünü göster$/ }).click();
  await expect(sheet).toBeHidden();
});

test("mobile: drawer drills into category levels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menüyü aç" }).click();
  const menu = page.getByRole("dialog", { name: "Menü" });
  await menu.getByRole("button", { name: /Moda/ }).click();
  await menu.getByRole("button", { name: /Erkek/ }).click();
  await expect(menu.getByRole("link", { name: "Tüm Erkek ürünleri" })).toBeVisible();
  await menu.getByRole("link", { name: /Kazak/ }).click();
  await expect(page).toHaveURL(/\/kategori\/erkek-kazak$/);
});
