import { redirect } from "next/navigation";
import { AdminShell } from "@/features/admin-shell/AdminShell";
import type { SidebarEntry, SidebarGroup } from "@/features/admin-shell/AdminSidebar";
import { ConfigToken } from "@/core";
import { GetStaffRolesToken } from "@/modules/identity";
import { currentPrincipal, resolveService } from "@/server/app";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Yönetim", template: "%s | nova. yönetim" }, robots: { index: false, follow: false } };

type NavLink = {
  type: "link";
  href: string;
  label: string;
  perm: string;
  icon: SidebarEntry["icon"];
};

type NavNest = {
  type: "nest";
  label: string;
  icon: SidebarEntry["icon"];
  children: NavLink[];
};

type NavEntry = NavLink | NavNest;

const NAV: Array<{ title: string; items: NavEntry[] }> = [
  {
    title: "ANA",
    items: [
      { type: "link", href: "/admin", label: "Dashboard", perm: "orders.read", icon: "dashboard" },
      { type: "link", href: "/admin/siparisler", label: "Siparişler", perm: "orders.read", icon: "orders" },
      { type: "link", href: "/admin/musteriler", label: "Müşteriler", perm: "customers.read", icon: "customers" },
    ],
  },
  {
    title: "KATALOG",
    items: [
      {
        type: "nest",
        label: "Catalog",
        icon: "products",
        children: [
          { type: "link", href: "/admin/urunler", label: "Ürünler", perm: "catalog.read", icon: "products" },
          { type: "link", href: "/admin/kategoriler", label: "Kategoriler", perm: "catalog.write", icon: "categories" },
          { type: "link", href: "/admin/markalar", label: "Markalar", perm: "catalog.write", icon: "brands" },
          { type: "link", href: "/admin/kampanyalar", label: "Kampanyalar", perm: "campaigns.write", icon: "campaigns" },
          { type: "link", href: "/admin/vitrin", label: "Vitrin", perm: "storefront.write", icon: "showcase" },
        ],
      },
    ],
  },
  {
    title: "YÖNETİM",
    items: [
      { type: "link", href: "/admin/odemeler", label: "Ödeme sistemleri", perm: "payments.reconcile", icon: "payments" },
      { type: "link", href: "/admin/entegrasyonlar", label: "Entegrasyonlar", perm: "integrations.write", icon: "integrations" },
      { type: "link", href: "/admin/kullanicilar", label: "Kullanıcılar", perm: "users.manage", icon: "users" },
      { type: "link", href: "/admin/icerik", label: "İçerik yönetimi", perm: "content.write", icon: "content" },
      { type: "link", href: "/admin/ayarlar", label: "Site ayarları", perm: "settings.write", icon: "settings" },
      { type: "link", href: "/admin/denetim", label: "Denetim kayıtları", perm: "audit.read", icon: "audit" },
    ],
  },
];

/** Every admin page is gated on the server. UI hiding below is convenience only; APIs re-check permissions. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentPrincipal("admin");
  if (!user) redirect("/admin/giris?next=/admin");
  if (!user.isStaff) redirect("/");

  const groups: SidebarGroup[] = NAV.map((group) => {
    const items: SidebarEntry[] = [];
    for (const item of group.items) {
      if (item.type === "nest") {
        const children = item.children.filter((c) => user.permissions.has(c.perm));
        if (children.length > 0) items.push({ type: "nest", label: item.label, icon: item.icon, children });
        continue;
      }
      if (user.permissions.has(item.perm)) items.push(item);
    }
    return { title: group.title, items };
  }).filter((g) => g.items.length > 0);

  const [roles, config] = await Promise.all([
    resolveService(GetStaffRolesToken).then((q) => q.execute(user.id)),
    resolveService(ConfigToken),
  ]);
  const can = (p: string) => user.permissions.has(p);

  return (
    <AdminShell
      user={{ displayName: user.displayName, email: user.email, roles }}
      groups={groups}
      quickCreate={{ product: can("catalog.write"), category: can("catalog.write"), brand: can("catalog.write"), page: can("content.write") }}
      env={config.isProduction ? "production" : "development"}
    >
      {children}
    </AdminShell>
  );
}
