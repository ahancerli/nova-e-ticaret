"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BookOpenText, BotMessageSquare, FileSpreadsheet, ChevronRight, Contact, CreditCard, FileCheck2, FileText, FolderTree, LayoutGrid, Mail, Megaphone, MessageSquareText, MessagesSquare, MonitorCog, Package, PlugZap, Settings, ShoppingCart, Tags, UsersRound, ReceiptText, Truck, Undo2, Search } from "lucide-react";

export type SidebarIcon =
  | "dashboard"
  | "orders"
  | "customers"
  | "products"
  | "categories"
  | "search"
  | "brands"
  | "campaigns"
  | "showcase"
  | "bulk"
  | "payments"
  | "integrations"
  | "users"
  | "settings"
  | "content"
  | "audit"
  | "reviews"
  | "notifications"
  | "support"
  | "shipping"
  | "returns"
  | "invoices"
  | "newsletter"
  | "social"
  | "guide";

type SidebarLink = {
  type: "link";
  href: string;
  label: string;
  icon: SidebarIcon;
  /** One-sentence purpose of the page (native tooltip here, info button in the top bar, user guide). */
  info?: string;
};

type SidebarNest = {
  type: "nest";
  label: string;
  icon: SidebarIcon;
  info?: string;
  children: SidebarLink[];
};

export type SidebarEntry = SidebarLink | SidebarNest;

export type SidebarGroup = {
  title: string;
  /** Group colour (CSS colour): the dot beside the title. */
  tone?: string;
  items: SidebarEntry[];
};

export const iconMap: Record<SidebarIcon, ComponentType<{ className?: string }>> = {
  dashboard: LayoutGrid,
  orders: ShoppingCart,
  customers: Contact,
  products: Package,
  categories: FolderTree,
  search: Search,
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
  reviews: MessageSquareText,
  notifications: Bell,
  support: MessagesSquare,
  shipping: Truck,
  returns: Undo2,
  invoices: ReceiptText,
  newsletter: Mail,
  social: BotMessageSquare,
  guide: BookOpenText,
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

const base = "relative flex items-center gap-2.5 rounded-lg px-3 text-sm transition-colors duration-200";
const idle = "text-indigo-100/70 hover:bg-white/[0.07] hover:text-white";
const selected = "font-medium text-white";
const SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.7 } as const;

function NavLink({ item, active, nested = false, onNavigate }: { item: SidebarLink; active: boolean; nested?: boolean; onNavigate?: () => void }) {
  return (
    <Link href={item.href} onClick={onNavigate} title={item.info} aria-current={active ? "page" : undefined} className={`${base} ${nested ? "py-2" : "py-2.5"} ${active ? selected : idle}`}>
      {/* one shared pill: it glides from the previous page's row to this one */}
      {active ? <motion.span layoutId="nav-active" transition={SPRING} aria-hidden className="absolute inset-0 rounded-lg bg-[#7367f0] shadow-lg shadow-[#7367f0]/30" /> : null}
      <span className="relative flex min-w-0 flex-1 items-center gap-2.5">
        {nested ? <span aria-hidden className={`size-1.5 flex-none rounded-full ${active ? "bg-white" : "bg-indigo-200/40"}`} /> : <ItemIcon icon={item.icon} />}
        <span className="truncate">{item.label}</span>
        <PendingDot />
      </span>
    </Link>
  );
}

export function AdminSidebar({ groups, onNavigate }: { groups: SidebarGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = activeHref(pathname, groups);
  // Nests containing the current page start open; afterwards the user is in control.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const g of groups) for (const i of g.items) if (i.type === "nest") o[i.label] = i.children.some((c) => c.href === current);
    return o;
  });

  return (
    <nav aria-label="Yönetim menüsü" className="px-3 pb-4">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="flex items-center gap-2 px-3 pb-2 pt-5 text-xs font-semibold text-indigo-200/60">
            <span aria-hidden className="size-2 flex-none rounded-full" style={{ backgroundColor: group.tone ?? "#94a3b8" }} />
            {group.title}
          </div>
          <div className="space-y-1">
            {group.items.map((item) => {
              if (item.type === "link") return <NavLink key={item.href} item={item} active={item.href === current} onNavigate={onNavigate} />;

              const containsCurrent = item.children.some((c) => c.href === current);
              // a nest that holds the open page cannot hide it
              const expanded = (open[item.label] ?? false) || containsCurrent;
              const panelId = `nav-${item.label.toLocaleLowerCase("tr-TR").replace(/\s+/g, "-")}`;
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    title={item.info}
                    onClick={() => setOpen((v) => ({ ...v, [item.label]: !expanded }))}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className={`${base} w-full py-2.5 ${containsCurrent ? "font-medium text-white hover:bg-white/[0.07]" : idle}`}
                  >
                    <ItemIcon icon={item.icon} />
                    <span className="truncate">{item.label}</span>
                    <motion.span aria-hidden animate={{ rotate: expanded ? 90 : 0 }} transition={SPRING} className="ml-auto flex-none">
                      <ChevronRight className="h-4 w-4" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded ? (
                      <motion.div id={panelId} key="panel" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }} className="overflow-hidden">
                        <div className="relative mt-1 space-y-1 pb-1 pl-5 before:absolute before:inset-y-1 before:left-[1.15rem] before:w-px before:bg-white/10">
                          {item.children.map((c) => (
                            <NavLink key={c.href} item={c} active={c.href === current} nested onNavigate={onNavigate} />
                          ))}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
