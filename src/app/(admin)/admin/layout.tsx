import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAdminUser } from "@/server/auth";
import { SearchIcon } from "@/components/icons";
import { AdminHeaderActions } from "@/components/admin/AdminHeaderActions";
import { AdminSidebar, type SidebarEntry, type SidebarGroup } from "@/components/admin/AdminSidebar";

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
  const user = await currentAdminUser();
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

  return (
    <div className="min-h-dvh bg-[#f5f6fb] xl:grid xl:grid-cols-[280px_1fr]">
      <aside className="border-r border-slate-800/70 bg-[#2a2e45] text-slate-200 xl:min-h-dvh">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <Link href="/admin" className="text-2xl font-extrabold tracking-tight text-white">nova<span className="text-indigo-300">.</span></Link>
          <span className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-300">v1</span>
        </div>
        <AdminSidebar groups={groups} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <label className="relative w-full max-w-md">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input placeholder="Ara (sipariş, müşteri, modül...)" className="input border-slate-200 pl-9 text-sm" />
            </label>
            <div className="flex items-center gap-3">
              <Link href="/admin/profil" className="hidden rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 md:inline-flex">{user.displayName}</Link>
              <Link href="/" className="hidden rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 md:inline-flex">Mağaza</Link>
              <AdminHeaderActions />
            </div>
          </div>
        </header>
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
