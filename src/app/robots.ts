import type { MetadataRoute } from "next";
import { GetPublicSettingsToken } from "@/modules/settings";
import { resolveService } from "@/server/app";
import { getEnv } from "@/server/env";

export const dynamic = "force-dynamic";

// Personal, transactional and duplicate-content pages stay out of search results.
const PRIVATE = ["/admin", "/api/", "/hesabim", "/hesap/", "/sepet", "/odeme", "/siparis/", "/siparis-sorgula", "/giris", "/uye-ol", "/sifremi-unuttum", "/ara", "/karsilastir"];

/** /robots.txt — follows Site ayarları › SEO "indexing allowed"; points crawlers at the sitemap. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const [{ PUBLIC_SITE_URL }, settings] = await Promise.all([getEnv(), resolveService(GetPublicSettingsToken).then((q) => q.execute())]);
  if (!settings.seo.allowIndexing) return { rules: { userAgent: "*", disallow: "/" } };
  const base = PUBLIC_SITE_URL.replace(/\/$/, "");
  return { rules: { userAgent: "*", allow: "/", disallow: PRIVATE }, sitemap: `${base}/sitemap.xml` };
}
