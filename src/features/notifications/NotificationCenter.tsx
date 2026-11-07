"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Bell, BellOff, CheckCheck, ChevronRight, Mail, MailOpen, Settings2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { inputCls } from "@/components/admin/form";
import {
  NOTIFICATION_FILTERS, NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS,
  type NotificationFilter, type NotificationRule, type NotificationType, type NotificationView,
} from "@/modules/notifications/domain/notification";
import { announceChange, notificationsApi } from "./api";
import { NotificationIcon, fullDate, timeAgo } from "./ui";

const PAGE = 20;

/** Bildirimler: inbox (filters, bulk read / archive) and settings (personal mutes; shop-wide rules with `settings.write`). */
export function NotificationCenter({ permissions, canManageRules }: { permissions: string[]; canManageRules: boolean }) {
  const [view, setView] = useState<"inbox" | "settings">("inbox");
  const myTypes = useMemo(() => NOTIFICATION_TYPE_KEYS.filter((t) => permissions.includes(NOTIFICATION_TYPES[t].permission)), [permissions]);
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Bildirimler" subtitle="Onay bekleyen yorumlar, yeni siparişler ve ödeme uyarıları. Okundu / arşiv durumu yalnız sizin için geçerlidir." />
      <div role="tablist" aria-label="Bildirim görünümü" className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {([["inbox", "Gelen kutusu", Bell], ["settings", "Ayarlar", Settings2]] as const).map(([key, label, Icon]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition ${view === key ? "bg-[#7367f0] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {view === "inbox" ? <Inbox types={myTypes} /> : <SettingsPanel types={myTypes} canManageRules={canManageRules} />}
    </div>
  );
}

function Inbox({ types }: { types: NotificationType[] }) {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [type, setType] = useState<NotificationType | "">("");
  const [rows, setRows] = useState<NotificationView[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useCallback((p: number) => {
    const q = new URLSearchParams({ filter, page: String(p), pageSize: String(PAGE) });
    if (type) q.set("type", type);
    return q.toString();
  }, [filter, type]);

  const apply = useCallback((r: Awaited<ReturnType<typeof notificationsApi.list>>, p: number, append: boolean) => {
    setRows((prev) => (append ? [...prev, ...r.data] : r.data));
    setTotal(Number(r.meta.total ?? 0));
    setUnread(Number(r.meta.unread ?? 0));
    setPage(p);
    if (!append) setSelected(new Set());
    setLoading(false);
  }, []);

  const failed = useCallback((err: unknown) => {
    notify.error(err, { id: "notifications-load", fallback: "Bildirimler yüklenemedi." });
    setLoading(false);
  }, []);

  const load = useCallback(async (p: number, append: boolean) => {
    try { apply(await notificationsApi.list(query(p)), p, append); } catch (err) { failed(err); }
  }, [query, apply, failed]);

  useEffect(() => {
    let live = true;
    notificationsApi.list(query(1)).then((r) => { if (live) apply(r, 1, false); }, (err) => { if (live) failed(err); });
    return () => { live = false; };
  }, [query, apply, failed]);

  const act = async (work: () => Promise<unknown>, message: string) => {
    try {
      await work();
      notify.success(message);
      announceChange();
      await load(1, false);
    } catch (err) {
      notify.error(err);
    }
  };

  const ids = [...selected];
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <AdminCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-3 pt-2 sm:px-4">
        <div role="tablist" aria-label="Bildirim filtresi" className="flex gap-1">
          {(Object.entries(NOTIFICATION_FILTERS) as [NotificationFilter, string][]).map(([key, label]) => {
            const on = key === filter;
            return (
              <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(key)}
                className={`relative flex items-center gap-2 px-3 py-3 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                {label}
                {key === "unread" && unread ? <span className="min-w-6 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums text-white">{unread}</span> : null}
                <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <select aria-label="Bildirim türü" value={type} onChange={(e) => setType(e.target.value as NotificationType | "")} className={`${inputCls} h-9 w-auto py-0`}>
            <option value="">Tüm türler</option>
            {types.map((t) => <option key={t} value={t}>{NOTIFICATION_TYPES[t].label}</option>)}
          </select>
          <button type="button" disabled={!unread} onClick={() => void act(() => notificationsApi.readAll(), "Tümü okundu olarak işaretlendi")}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">
            <CheckCheck className="size-4" /> Tümünü okundu say
          </button>
        </div>
      </div>

      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} className="size-4 accent-[#7367f0]" aria-label="Sayfadakilerin hepsini seç" />
          {selected.size ? `${selected.size} seçili` : `${total} bildirim`}
        </label>
        {selected.size ? (
          <div className="ml-auto flex flex-wrap gap-1.5">
            <BarButton icon={MailOpen} label="Okundu" onClick={() => void act(() => notificationsApi.read(ids, true), "Okundu olarak işaretlendi")} />
            <BarButton icon={Mail} label="Okunmadı" onClick={() => void act(() => notificationsApi.read(ids, false), "Okunmadı olarak işaretlendi")} />
            {filter === "archived"
              ? <BarButton icon={ArchiveRestore} label="Arşivden çıkar" onClick={() => void act(() => notificationsApi.archive(ids, false), "Arşivden çıkarıldı")} />
              : <BarButton icon={Archive} label="Arşivle" onClick={() => void act(() => notificationsApi.archive(ids, true), "Arşivlendi")} />}
          </div>
        ) : null}
      </div>

      {loading && !rows.length ? (
        <div className="space-y-2 p-4" aria-busy>{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-slate-100 text-slate-400"><Bell className="size-6" /></span>
          <p className="font-medium text-slate-700">{filter === "unread" ? "Okunmamış bildirim yok" : filter === "archived" ? "Arşiv boş" : "Henüz bildirim yok"}</p>
          <p className="text-sm text-slate-500">Yeni bir yorum veya sipariş geldiğinde burada görünecek.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((n) => (
            <li key={n.id} className={`group flex items-start gap-3 px-4 py-3.5 transition hover:bg-slate-50 ${n.readAt ? "" : "bg-[#7367f0]/[0.035]"}`}>
              <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} className="mt-3 size-4 flex-none accent-[#7367f0]" aria-label={`${n.title} seç`} />
              <NotificationIcon type={n.type} severity={n.severity} size="size-10" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${n.readAt ? "text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</span>
                  {!n.readAt ? <span className="size-2 rounded-full bg-[#7367f0]" aria-label="Okunmadı" /> : null}
                </p>
                {n.body ? <p className="mt-0.5 text-sm text-slate-500">{n.body}</p> : null}
                <p className="mt-1 text-xs text-slate-400" title={fullDate(n.createdAt)}>
                  {NOTIFICATION_TYPES[n.type as NotificationType]?.label ?? n.type} · {timeAgo(n.createdAt)}
                </p>
              </div>
              <div className="flex flex-none items-center gap-1">
                <IconButton label={n.readAt ? "Okunmadı yap" : "Okundu yap"} icon={n.readAt ? Mail : MailOpen} onClick={() => void act(() => notificationsApi.read([n.id], !n.readAt), n.readAt ? "Okunmadı olarak işaretlendi" : "Okundu olarak işaretlendi")} />
                <IconButton label={n.archivedAt ? "Arşivden çıkar" : "Arşivle"} icon={n.archivedAt ? ArchiveRestore : Archive} onClick={() => void act(() => notificationsApi.archive([n.id], !n.archivedAt), n.archivedAt ? "Arşivden çıkarıldı" : "Arşivlendi")} />
                {n.href ? (
                  <Link href={n.href} onClick={() => { if (!n.readAt) void notificationsApi.read([n.id]).then(announceChange).catch(() => {}); }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-[#5b4fe0] transition hover:bg-[#7367f0]/10">
                    Aç <ChevronRight className="size-3.5" />
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length < total ? (
        <div className="border-t border-slate-100 p-3 text-center">
          <button type="button" disabled={loading} onClick={() => { setLoading(true); void load(page + 1, true); }} className="h-9 rounded-lg px-4 text-sm font-medium text-[#5b4fe0] transition hover:bg-[#7367f0]/10 disabled:opacity-50">
            {loading ? "Yükleniyor…" : `Daha fazla göster (${total - rows.length})`}
          </button>
        </div>
      ) : null}
    </AdminCard>
  );
}

function SettingsPanel({ types, canManageRules }: { types: NotificationType[]; canManageRules: boolean }) {
  const [muted, setMuted] = useState<Set<string> | null>(null);
  const [rules, setRules] = useState<(NotificationRule & { emailText: string })[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    notificationsApi.preferences().then((r) => setMuted(new Set(r.data.muted))).catch((err) => notify.error(err));
    if (canManageRules) notificationsApi.rules().then((r) => setRules(r.data.map((x) => ({ ...x, emailText: x.emailTo.join(", ") })))).catch((err) => notify.error(err));
  }, [canManageRules]);

  const toggleMute = async (t: NotificationType) => {
    if (!muted) return;
    const next = new Set(muted);
    if (next.has(t)) next.delete(t); else next.add(t);
    setMuted(next);
    try {
      await notificationsApi.savePreferences([...next]);
      announceChange();
    } catch (err) {
      setMuted(muted);
      notify.error(err);
    }
  };

  const saveRules = async () => {
    if (!rules) return;
    setBusy(true);
    try {
      const r = await notificationsApi.saveRules(rules.map((x) => ({ type: x.type, inApp: x.inApp, email: x.email, emailTo: x.emailText.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean) })));
      setRules(r.data.map((x) => ({ ...x, emailText: x.emailTo.join(", ") })));
      notify.success("Bildirim kuralları güncellendi");
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <AdminCard>
        <AdminCardTitle title="Benim için" subtitle="Görmek istemediğiniz türleri kapatın. Diğer kullanıcıları etkilemez." />
        <ul className="divide-y divide-slate-100">
          {types.length === 0 ? <li className="px-5 py-6 text-sm text-slate-500">Yetkilerinize uygun bildirim türü yok.</li> : null}
          {types.map((t) => {
            const on = muted ? !muted.has(t) : true;
            return (
              <li key={t} className="flex items-center justify-between gap-4 px-5 py-4">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-800">{on ? <Bell className="size-4 text-[#7367f0]" /> : <BellOff className="size-4 text-slate-400" />}{NOTIFICATION_TYPES[t].label}</span>
                  <span className="block text-xs text-slate-500">{NOTIFICATION_TYPES[t].description}</span>
                </span>
                <Switch checked={on} disabled={!muted} onChange={() => void toggleMute(t)} label={`${NOTIFICATION_TYPES[t].label} bana gösterilsin`} />
              </li>
            );
          })}
        </ul>
      </AdminCard>

      {canManageRules ? (
        <AdminCard>
          <AdminCardTitle title="Mağaza geneli kurallar" subtitle="Bildirim panelde gösterilsin mi, e-postayla kimlere gitsin? (Site ayarları yetkisi)"
            actions={<button type="button" disabled={!rules || busy} onClick={() => void saveRules()} className="h-9 rounded-lg bg-[#7367f0] px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-[#6559df] disabled:opacity-50">Güncelle</button>} />
          {!rules ? <div className="m-5 h-40 animate-pulse rounded-xl bg-slate-100" /> : (
            <ul className="divide-y divide-slate-100">
              {rules.map((r, i) => {
                const set = (patch: Partial<typeof r>) => setRules((all) => all && all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <li key={r.type} className="space-y-3 px-5 py-4">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{r.label}</p>
                      <p className="text-xs text-slate-500">{r.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-slate-700">
                      <label className="flex items-center gap-2"><Switch checked={r.inApp} onChange={() => set({ inApp: !r.inApp })} label="Panelde göster" /> Panelde göster</label>
                      <label className="flex items-center gap-2"><Switch checked={r.email} onChange={() => set({ email: !r.email })} label="E-posta gönder" /> E-posta gönder</label>
                    </div>
                    {r.email ? (
                      <input value={r.emailText} onChange={(e) => set({ emailText: e.target.value })} className={inputCls} placeholder="ornek@magaza.com, depo@magaza.com" aria-label={`${r.label} e-posta alıcıları`} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </AdminCard>
      ) : null}
    </div>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition disabled:opacity-50 ${checked ? "bg-[#7367f0]" : "bg-slate-300"}`}>
      <span className={`inline-block size-5 rounded-full bg-white shadow transition ${checked ? "translate-x-5.5" : "translate-x-0.5"}`} />
    </button>
  );
}

function IconButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="grid size-8 place-items-center rounded-lg text-slate-400 opacity-100 transition hover:bg-slate-100 hover:text-slate-700 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
      <Icon className="size-4" />
    </button>
  );
}

function BarButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
      <Icon className="size-3.5" /> {label}
    </button>
  );
}
