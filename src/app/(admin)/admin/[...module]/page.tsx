import Link from "next/link";
import { currentAdminUser } from "@/server/auth";
import { notFound } from "next/navigation";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";

const MODULES: Record<string, { title: string; tables: string; api: string }> = {
  urunler: { title: "Ürünler", tables: "products, product_variants, variant_prices, inventory_balances, product_media, product_attribute_values", api: "/api/admin/products" },
  kategoriler: { title: "Kategoriler", tables: "categories, category_attributes, seo_documents", api: "/api/admin/categories" },
  markalar: { title: "Markalar", tables: "brands, seo_documents", api: "/api/admin/brands" },
  kampanyalar: { title: "Kampanyalar ve kuponlar", tables: "campaigns, campaign_products/brands/categories, coupons", api: "/api/admin/campaigns" },
  vitrin: { title: "Vitrin", tables: "sliders, slides, story_collections, stories, story_frames, home_sections", api: "/api/admin/home" },
  odemeler: { title: "Ödeme sistemleri", tables: "payment_configs, bank_accounts, integration_secrets, bank_transfers", api: "/api/admin/payments" },
  entegrasyonlar: { title: "Entegrasyonlar", tables: "integrations, integration_secrets, shipping_methods", api: "/api/admin/integrations" },
  kullanicilar: { title: "Kullanıcılar ve roller", tables: "users, staff_profiles, roles, permissions, user_roles", api: "/api/admin/users" },
  ayarlar: { title: "Site ve SEO ayarları", tables: "site_settings, seo_documents, content_pages, navigation_menus/items", api: "/api/admin/settings" },
  denetim: { title: "Denetim kayıtları", tables: "audit_logs", api: "/api/admin/audit" },
};

/** Placeholder for admin modules that are modelled in the schema but not built yet (see README roadmap). */
export default async function AdminModulePlaceholder({ params }: { params: Promise<{ module: string[] }> }) {
  const { module } = await params;
  const m = MODULES[module[0] ?? ""];
  const user = await currentAdminUser();
  if (!m || !user?.isStaff) notFound();
  return (
    <div className="space-y-6">
      <AdminPageHeader title={m.title} subtitle="Bu bölüm için UI iskeleti hazırlandı, CRUD entegrasyonu sıradaki adımda tamamlanacak." />
      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Modül özeti" actions={<AdminBadge tone="amber">Roadmap</AdminBadge>} />
        <div className="space-y-4 px-5 py-5 text-sm">
          <p className="text-slate-600">
            Bu modülün veri modeli hazır (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-700">{m.tables}</code>).
          </p>
          <p className="text-slate-600">
            API sözleşmesi: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-700">{m.api}</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/siparisler" className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Siparişlere dön</Link>
            <Link href="/admin" className="inline-flex min-h-9 items-center rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700">Panele dön</Link>
          </div>
        </div>
      </AdminCard>
    </div>
  );
}
