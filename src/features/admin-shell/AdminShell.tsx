"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight, ExternalLink, FileText, FolderTree, LogOut, Menu, Package, Plus, Search, Store, Tags, UserRound, X,
} from "lucide-react";
import { UNAUTHORIZED_EVENT } from "@/lib/api-client";
import { authApi } from "@/features/auth/api";
import { notify } from "@/lib/toast";
import { useDialogFocus, useIsClient, usePresence } from "@/lib/motion";
import { Popover } from "@/components/ui/Popover";
import { Portal } from "@/components/ui/Portal";
import { AdminSidebar, iconMap, type SidebarGroup } from "@/features/admin-shell/AdminSidebar";
import { CommandPalette, type PaletteItem } from "@/features/admin-shell/CommandPalette";
import { NotificationBell } from "@/features/notifications/NotificationBell";

export type ShellUser = { displayName: string; email: string; roles: string[] };
export type QuickCreate = { product: boolean; category: boolean; brand: boolean; page: boolean };

const EXTRA_LABELS: Record<string, string> = { "/admin": "Panel", "/admin/profil": "Profilim" };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toLocaleUpperCase("tr-TR") ?? "").join("") || "?";
}

/** Admin chrome: sidebar (fixed on desktop, sliding drawer on mobile), sticky top bar, command palette. */
export function AdminShell({ user, groups, quickCreate, env, children }: { user: ShellUser; groups: SidebarGroup[]; quickCreate: QuickCreate; env: "development" | "production"; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Session expired (any API call answered 401): say so once and go to the login page, then come back here.
  useEffect(() => {
    let handled = false;
    const onUnauthorized = () => {
      if (handled) return;
      handled = true;
      notify.warning("Oturumunuzun süresi doldu", { id: "session-expired", description: "Devam etmek için tekrar giriş yapın." });
      router.replace(`/admin/giris?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [router]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isClient = useIsClient();
  const isMac = isClient && /Mac|iPhone|iPad/.test(navigator.platform);

  // ⌘K / Ctrl+K anywhere in the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const links = useMemo(() => groups.flatMap((g) => g.items.flatMap((i) => (i.type === "link" ? [{ ...i, group: g.title }] : i.children.map((c) => ({ ...c, group: g.title }))))), [groups]);

  const crumbs = useMemo(() => {
    const labels: Record<string, string> = { ...EXTRA_LABELS, ...Object.fromEntries(links.map((l) => [l.href, l.label])) };
    const parts = pathname.split("/").filter(Boolean);
    return parts.map((seg, i) => {
      const href = `/${parts.slice(0, i + 1).join("/")}`;
      const label = labels[href] ?? (seg === "yeni" ? "Yeni" : i === parts.length - 1 && i > 1 ? "Düzenle" : seg);
      return { href, label };
    });
  }, [pathname, links]);

  const paletteItems = useMemo<PaletteItem[]>(() => [
    ...(quickCreate.product ? [{ id: "new-product", label: "Yeni ürün oluştur", group: "Hızlı işlemler", href: "/admin/urunler/yeni", icon: Package, keywords: "ekle urun" }] : []),
    ...(quickCreate.category ? [{ id: "new-category", label: "Yeni kategori oluştur", group: "Hızlı işlemler", href: "/admin/kategoriler/yeni", icon: FolderTree, keywords: "ekle" }] : []),
    ...(quickCreate.brand ? [{ id: "new-brand", label: "Yeni marka oluştur", group: "Hızlı işlemler", href: "/admin/markalar/yeni", icon: Tags, keywords: "ekle" }] : []),
    ...(quickCreate.page ? [{ id: "new-page", label: "Yeni içerik sayfası oluştur", group: "Hızlı işlemler", href: "/admin/icerik/yeni", icon: FileText, keywords: "ekle sayfa sozlesme kvkk yasal" }] : []),
    ...links.map((l) => ({ id: l.href, label: l.label, group: "Sayfalar", href: l.href, icon: iconMap[l.icon] })),
    { id: "profile", label: "Profilim", group: "Hesap", href: "/admin/profil", icon: UserRound },
    { id: "store", label: "Mağazayı yeni sekmede aç", group: "Hesap", href: "/", icon: Store, external: true },
  ], [links, quickCreate]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout("admin");
      router.replace("/admin/giris");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Çıkış yapılamadı." });
    }
  }, [router]);

  const canCreate = quickCreate.product || quickCreate.category || quickCreate.brand || quickCreate.page;
  const iconBtn = "inline-flex size-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 aria-expanded:bg-slate-100 aria-expanded:text-slate-800";

  return (
    <div className="min-h-dvh bg-[#f5f6fb] xl:grid xl:grid-cols-[272px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-white/5 bg-[#25293c] text-slate-200 xl:flex">
        <SidebarContent groups={groups} env={env} />
      </aside>
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} groups={groups} env={env} />

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl backdrop-saturate-150">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6">
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="Menüyü aç" className={`${iconBtn} xl:hidden`}>
              <Menu className="h-5 w-5" />
            </button>

            <nav aria-label="Sayfa yolu" className="hidden min-w-0 md:block">
              <ol className="flex items-center gap-1.5 text-sm">
                {crumbs.map((c, i) => (
                  <li key={c.href} className="flex min-w-0 items-center gap-1.5">
                    {i > 0 ? <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-300" /> : null}
                    {i === crumbs.length - 1 ? (
                      <span aria-current="page" className="truncate font-semibold text-slate-800">{c.label}</span>
                    ) : (
                      <Link href={c.href} className="truncate text-slate-500 transition hover:text-slate-800">{c.label}</Link>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            <div className="flex flex-1 justify-center px-1">
              <button type="button" onClick={() => setPaletteOpen(true)}
                className="group flex h-10 w-full max-w-md items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-sm text-slate-400 transition hover:border-slate-300 hover:bg-white hover:text-slate-500">
                <Search className="h-4 w-4 flex-none" />
                <span className="flex-1 truncate text-left">Ara veya bir komut çalıştır…</span>
                <kbd className="hidden flex-none items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm sm:inline-flex">
                  {isMac ? "⌘" : "Ctrl"} K
                </kbd>
              </button>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5">
              <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide lg:inline-flex ${env === "production" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                <span className={`size-1.5 rounded-full ${env === "production" ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} />
                {env === "production" ? "Canlı" : "Local"}
              </span>

              {canCreate ? (
                <Popover label="Yeni oluştur" panelClassName="w-60"
                  buttonClassName="hidden h-10 items-center gap-1.5 rounded-xl bg-[#7367f0] px-3.5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:bg-[#6559df] sm:inline-flex"
                  button={<><Plus className="h-4 w-4" /> Yeni</>}>
                  {(close) => (
                    <div className="p-1.5">
                      <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Hızlı oluştur</p>
                      {quickCreate.product ? <MenuLink href="/admin/urunler/yeni" icon={Package} label="Ürün" desc="Varyant, fiyat ve stokla" onClick={close} /> : null}
                      {quickCreate.category ? <MenuLink href="/admin/kategoriler/yeni" icon={FolderTree} label="Kategori" desc="Ağaçta yeni düğüm" onClick={close} /> : null}
                      {quickCreate.brand ? <MenuLink href="/admin/markalar/yeni" icon={Tags} label="Marka" desc="Logo ve banner ile" onClick={close} /> : null}
                      {quickCreate.page ? <MenuLink href="/admin/icerik/yeni" icon={FileText} label="İçerik sayfası" desc="Yasal metin, kurumsal, yardım" onClick={close} /> : null}
                    </div>
                  )}
                </Popover>
              ) : null}

              <a href="/" target="_blank" rel="noopener" aria-label="Mağazayı yeni sekmede aç" title="Mağazayı aç" className={`${iconBtn} hidden sm:inline-flex`}>
                <Store className="h-[18px] w-[18px]" />
              </a>

              <NotificationBell buttonClassName={iconBtn} />

              <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" aria-hidden />

              <Popover label="Hesap menüsü" panelClassName="w-72"
                buttonClassName="flex items-center gap-2.5 rounded-xl p-1 pr-1 transition hover:bg-slate-100 aria-expanded:bg-slate-100 lg:pr-2.5"
                button={
                  <>
                    <span className="relative grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#7367f0] to-[#9e95f5] text-xs font-bold text-white shadow-sm">
                      {initials(user.displayName)}
                      <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-emerald-500" aria-hidden />
                    </span>
                    <span className="hidden text-left leading-tight lg:block">
                      <span className="block max-w-36 truncate text-sm font-semibold text-slate-800">{user.displayName}</span>
                      <span className="block max-w-36 truncate text-[11px] text-slate-500">{user.roles[0] ?? "Personel"}</span>
                    </span>
                  </>
                }>
                {(close) => (
                  <div>
                    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
                      <span className="grid size-10 flex-none place-items-center rounded-xl bg-gradient-to-br from-[#7367f0] to-[#9e95f5] text-sm font-bold text-white">{initials(user.displayName)}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{user.displayName}</p>
                        <p className="truncate text-xs text-slate-500">{user.email}</p>
                      </div>
                    </div>
                    {user.roles.length ? (
                      <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2.5">
                        {user.roles.map((r) => <span key={r} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-[#5b4fe0]">{r}</span>)}
                      </div>
                    ) : null}
                    <div className="p-1.5">
                      <MenuLink href="/admin/profil" icon={UserRound} label="Profilim" onClick={close} />
                      <a href="/" target="_blank" rel="noopener" onClick={close} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
                        <Store className="h-4 w-4 text-slate-400" /> <span className="flex-1">Mağazayı aç</span> <ExternalLink className="h-3.5 w-3.5 text-slate-300" />
                      </a>
                    </div>
                    <div className="border-t border-slate-100 p-1.5">
                      <button type="button" onClick={() => { close(); void logout(); }} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50">
                        <LogOut className="h-4 w-4" /> Çıkış yap
                      </button>
                    </div>
                  </div>
                )}
              </Popover>
            </div>
          </div>
        </header>
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
    </div>
  );
}

function MenuLink({ href, icon: Icon, label, desc, onClick }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; desc?: string; onClick: () => void }) {
  return (
    <Link href={href} onClick={onClick} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
      <span className="grid size-8 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 leading-tight">
        <span className="block font-medium">{label}</span>
        {desc ? <span className="block truncate text-xs text-slate-500">{desc}</span> : null}
      </span>
    </Link>
  );
}

function SidebarContent({ groups, env, onNavigate }: { groups: SidebarGroup[]; env: "development" | "production"; onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-16 flex-none items-center gap-3 border-b border-white/5 px-5">
        <Link href="/admin" onClick={onNavigate} className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#7367f0] to-[#a29bfe] text-lg font-black text-white shadow-lg shadow-[#7367f0]/40">n</span>
          <span className="leading-tight">
            <span className="block text-lg font-extrabold tracking-tight text-white">nova<span className="text-[#a29bfe]">.</span></span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Yönetim Paneli</span>
          </span>
        </Link>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <AdminSidebar groups={groups} onNavigate={onNavigate} />
      </div>
      <div className="flex-none border-t border-white/5 p-4">
        <div className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold uppercase tracking-wide text-slate-400">Ortam</span>
            <span className={`inline-flex items-center gap-1.5 font-semibold ${env === "production" ? "text-emerald-400" : "text-amber-300"}`}>
              <span className={`size-1.5 rounded-full ${env === "production" ? "bg-emerald-400" : "bg-amber-300"}`} />{env === "production" ? "Canlı" : "Local"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">nova. commerce · v1.0</p>
        </div>
      </div>
    </>
  );
}

function MobileSidebar({ open, onClose, groups, env }: { open: boolean; onClose: () => void; groups: SidebarGroup[]; env: "development" | "production" }) {
  const ref = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  useDialogFocus(ref, open && presence.mounted, onClose);
  if (!presence.mounted) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] xl:hidden" role="presentation">
        <button type="button" tabIndex={-1} aria-label="Menüyü kapat" data-state={presence.state} onClick={onClose}
          className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <div ref={ref} role="dialog" aria-modal="true" aria-label="Yönetim menüsü" data-state={presence.state} onAnimationEnd={presence.onAnimationEnd}
          className="absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col bg-[#25293c] text-slate-200 shadow-2xl data-[state=closed]:animate-slide-out-left data-[state=open]:animate-slide-in-left">
          <button type="button" onClick={onClose} aria-label="Kapat" className="absolute right-3 top-3.5 z-10 grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
          <SidebarContent groups={groups} env={env} onNavigate={onClose} />
        </div>
      </div>
    </Portal>
  );
}
