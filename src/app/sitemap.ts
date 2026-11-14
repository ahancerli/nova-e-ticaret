import type { MetadataRoute } from "next";
import { GetPublicSettingsToken } from "@/modules/settings";
import { GetSitemapToken } from "@/modules/storefront";
import { resolveService } from "@/server/app";
import { getEnv } from "@/server/env";

// Catalog changes every day; the file is built per request from the database (no build-time DB).
export const dynamic = "force-dynamic";

const STATIC = ["/", "/kategoriler", "/markalar", "/kampanyalar"];
const PRIORITY = { product: 0.8, category: 0.7, brand: 0.5, page: 0.3 } as const;

/** /sitemap.xml — published catalog + content pages; empty while Site ayarları › SEO forbids indexing. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ PUBLIC_SITE_URL }, settings] = await Promise.all([getEnv(), resolveService(GetPublicSettingsToken).then((q) => q.execute())]);
  if (!settings.seo.allowIndexing) return [];
  const base = PUBLIC_SITE_URL.replace(/\/$/, "");
  const entries = await (await resolveService(GetSitemapToken)).execute();
  return [
    ...STATIC.map((p) => ({ url: `${base}${p === "/" ? "" : p}`, changeFrequency: "daily" as const, priority: p === "/" ? 1 : 0.6 })),
    ...entries.map((e) => ({ url: `${base}${e.path}`, lastModified: e.updatedAt ?? undefined, priority: PRIORITY[e.kind] })),
  ];
}
