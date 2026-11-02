import { redirect } from "next/navigation";
import { getEnv, queryAll } from "@/server/db";
import { AdminShell } from "@/components/admin/AdminShell";
import type { SidebarEntry, SidebarGroup } from "@/components/admin/AdminSidebar";
import { currentPrincipal } from "@/server/app";

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
      { type: "link", href: "/admin/ayarlar", label: "Ayarlar", perm: "settings.write", icon: "settings" },
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

  const [roles, env] = await Promise.all([
    queryAll<{ name: string }>("SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.is_system DESC, r.name", user.id),
    getEnv(),
  ]);
  const can = (p: string) => user.permissions.has(p);

  return (
    <AdminShell
      user={{ displayName: user.displayName, email: user.email, roles: roles.map((r) => r.name) }}
      groups={groups}
      quickCreate={{ product: can("catalog.write"), category: can("catalog.write"), brand: can("catalog.write") }}
      env={env.APP_ENV === "production" ? "production" : "development"}
    >
      {children}
    </AdminShell>
  );
}
