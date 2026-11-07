"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";
import {
  FileSpreadsheet,
  ChevronRight,
  Contact,
  CreditCard,
  FileCheck2,
  FileText,
  FolderTree,
  LayoutGrid,
  Megaphone,
  MonitorCog,
  Package,
  PlugZap,
  Settings,
  ShoppingCart,
  Tags,
  UsersRound,
} from "lucide-react";
import { Collapsible } from "@/components/ui/Collapsible";

export type SidebarIcon =
  | "dashboard"
  | "orders"
  | "customers"
  | "products"
  | "categories"
  | "brands"
  | "campaigns"
  | "showcase"
  | "bulk"
  | "payments"
  | "integrations"
  | "users"
  | "settings"
  | "content"
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

export const iconMap: Record<SidebarIcon, ComponentType<{ className?: string }>> = {
  dashboard: LayoutGrid,
  orders: ShoppingCart,
  customers: Contact,
  products: Package,
  categories: FolderTree,
  brands: Tags,
  campaigns: Megaphone,
  showcase: MonitorCog,
  bulk: FileSpreadsheet,
  payments: CreditCard,
  integrations: PlugZap,
  users: UsersRound,
  settings: Settings,
  content: FileText,
  audit: FileCheck2,
};

function ItemIcon({ icon }: { icon: SidebarIcon }) {
  const Cmp = iconMap[icon];
  return <Cmp className="h-4 w-4 flex-none" />;
}

/** Longest matching href wins, so /admin does not light up on /admin/siparisler. */
function activeHref(pathname: string, groups: SidebarGroup[]): string | null {
  const hrefs = groups.flatMap((g) => g.items.flatMap((i) => (i.type === "link" ? [i.href] : i.children.map((c) => c.href))));
  return hrefs
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Pulsing dot shown while the clicked link's route is still loading (fixed size → no layout shift). */
function PendingDot() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`ml-auto size-1.5 flex-none rounded-full bg-current transition-opacity ${pending ? "animate-pulse opacity-80" : "opacity-0"}`} />;
}

const base = "flex items-center gap-2.5 rounded-lg px-3 text-sm transition-[background-color,color,box-shadow] duration-200";
const idle = "text-slate-300 hover:bg-white/[0.07] hover:text-white";
const selected = "bg-[#7367f0] font-medium text-white shadow-lg shadow-[#7367f0]/30";

function NavLink({ item, active, nested = false, onNavigate }: { item: SidebarLink; active: boolean; nested?: boolean; onNavigate?: () => void }) {
  return (
    <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${base} ${nested ? "py-2" : "py-2.5"} ${active ? selected : idle}`}>
      {nested ? <span aria-hidden className={`size-1.5 flex-none rounded-full ${active ? "bg-white" : "bg-slate-500"}`} /> : <ItemIcon icon={item.icon} />}
      <span className="truncate">{item.label}</span>
      <PendingDot />
    </Link>
  );
}

export function AdminSidebar({ groups, onNavigate }: { groups: SidebarGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  // Groups containing the current page start open; afterwards the user is in control.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const g of groups) for (const i of g.items) if (i.type === "nest") o[i.label] = i.children.some((c) => c.href === current);
    return o;
  });

  return (
    <nav aria-label="Yönetim menüsü" className="px-3 pb-4">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="px-3 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{group.title}</div>
          <div className="space-y-1">
            {group.items.map((item) => {
              if (item.type === "link") return <NavLink key={item.href} item={item} active={item.href === current} onNavigate={onNavigate} />;

              const expanded = open[item.label] ?? false;
              const containsCurrent = item.children.some((c) => c.href === current);
              const panelId = `nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`;
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    onClick={() => setOpen((v) => ({ ...v, [item.label]: !expanded }))}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className={`${base} w-full py-2.5 ${containsCurrent ? "font-medium text-white hover:bg-white/[0.07]" : idle}`}
                  >
                    <ItemIcon icon={item.icon} />
                    <span className="truncate">{item.label}</span>
                    <ChevronRight className={`ml-auto h-4 w-4 flex-none transition-transform duration-300 ease-out-expo ${expanded ? "rotate-90" : ""}`} />
                  </button>
                  <Collapsible id={panelId} open={expanded}>
                    <div className="relative mt-1 space-y-1 pb-1 pl-5 before:absolute before:inset-y-1 before:left-[1.15rem] before:w-px before:bg-white/10">
                      {item.children.map((c) => (
                        <NavLink key={c.href} item={c} active={c.href === current} nested onNavigate={onNavigate} />
                      ))}
                    </div>
                  </Collapsible>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
