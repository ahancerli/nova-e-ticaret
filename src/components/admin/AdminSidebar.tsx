"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ComponentType } from "react";
import {
  ChevronRight,
  CreditCard,
  FileCheck2,
  FolderTree,
  LayoutGrid,
  Megaphone,
  MonitorCog,
  Package,
  PlugZap,
  ShoppingCart,
  Tags,
  UsersRound,
} from "lucide-react";

export type SidebarIcon =
  | "dashboard"
  | "orders"
  | "products"
  | "categories"
  | "brands"
  | "campaigns"
  | "showcase"
  | "payments"
  | "integrations"
  | "users"
  | "settings"
  | "audit";

type SidebarLink = {
  type: "link";
  href: string;
  label: string;
  icon: SidebarIcon;
};

type SidebarNest = {
  type: "nest";
  label: string;
  icon: SidebarIcon;
  children: SidebarLink[];
};

export type SidebarEntry = SidebarLink | SidebarNest;

export type SidebarGroup = {
  title: string;
  items: SidebarEntry[];
};

const iconMap: Record<SidebarIcon, ComponentType<{ className?: string }>> = {
  dashboard: LayoutGrid,
  orders: ShoppingCart,
  products: Package,
  categories: FolderTree,
  brands: Tags,
  campaigns: Megaphone,
  showcase: MonitorCog,
  payments: CreditCard,
  integrations: PlugZap,
  users: UsersRound,
  settings: LayoutGrid,
  audit: FileCheck2,
};

function ItemIcon({ icon }: { icon: SidebarIcon }) {
  const Cmp = iconMap[icon];
  return <Cmp className="h-4 w-4" />;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar({ groups }: { groups: SidebarGroup[] }) {
  const pathname = usePathname();
  const initialOpen = useMemo(() => {
    const open: Record<string, boolean> = {};
    for (const g of groups) {
      for (const item of g.items) {
        if (item.type === "nest") {
          open[item.label] = item.children.some((c) => isActive(pathname, c.href));
        }
      }
    }
    return open;
  }, [groups, pathname]);
  const [open, setOpen] = useState<Record<string, boolean>>(initialOpen);

  return (
    <nav aria-label="Yönetim menüsü" className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-3 xl:block xl:overflow-visible xl:px-4 xl:pb-4">
      {groups.map((group) => (
        <div key={group.title} className="min-w-64 xl:min-w-0">
          <div className="px-3 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{group.title}</div>
          <div className="space-y-1">
            {group.items.map((item) => {
              if (item.type === "link") {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition ${
                      active ? "bg-[#7367f0] text-white shadow-lg shadow-[#7367f0]/30" : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <ItemIcon icon={item.icon} />
                      <span>{item.label}</span>
                    </span>
                  </Link>
                );
              }

              const expanded = open[item.label] ?? false;
              const childActive = item.children.some((c) => isActive(pathname, c.href));
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    onClick={() => setOpen((v) => ({ ...v, [item.label]: !expanded }))}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition ${
                      childActive ? "bg-[#7367f0] text-white shadow-lg shadow-[#7367f0]/30" : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                    aria-expanded={expanded}
                  >
                    <span className="flex items-center gap-2.5">
                      <ItemIcon icon={item.icon} />
                      <span>{item.label}</span>
                    </span>
                    <ChevronRight className={`h-4 w-4 transition ${expanded ? "rotate-90" : ""}`} />
                  </button>
                  {expanded ? (
                    <div className="mt-1 space-y-1 pl-6">
                      {item.children.map((c) => {
                        const active = isActive(pathname, c.href);
                        return (
                          <Link
                            key={c.href}
                            href={c.href}
                            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                              active ? "bg-[#7367f0] text-white shadow-lg shadow-[#7367f0]/30" : "text-slate-300 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            <span className="flex items-center gap-2.5">
                              <ItemIcon icon={c.icon} />
                              <span>{c.label}</span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
