import type { FullConfig } from "@playwright/test";

/**
 * `next dev` compiles a route on its first request and pushes a full reload to open pages meanwhile,
 * which makes browser steps flaky. Every route the tests visit is requested once here, so compilation is
 * done before the first test starts.
 */
const ROUTES = [
  "/", "/urun/cocuklar-icin-dunya-atlasi", "/odeme", "/siparis/sonuc?durum=havale",
  "/admin/giris", "/admin", "/admin/siparisler", "/admin/siparisler/ord_demo_1", "/admin/kategoriler", "/admin/kategoriler/yeni",
  "/api/home", "/api/cart", "/api/admin/orders",
];

export default async function globalSetup(config: FullConfig) {
  const base = config.projects[0]!.use.baseURL!;
  for (const route of ROUTES) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(base + route, { redirect: "manual" }).catch(() => null);
      if (res && res.status < 500) break;
    }
  }
}
