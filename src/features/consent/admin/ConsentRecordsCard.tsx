"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminTable } from "@/components/admin/ui";
import { errorMessage } from "@/lib/api-client";
import type { ConsentRecordRow } from "@/modules/consent";
import { consentApi } from "../api";

const PAGE_SIZE = 25;
const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const btn = "inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const ACTION = { accept_all: { label: "Tümünü kabul", tone: "green" }, reject_all: { label: "Tümünü ret", tone: "red" }, custom: { label: "Özel seçim", tone: "blue" } } as const;
const SOURCE = { banner: "Banner", preferences: "Tercihler penceresi", external: "Harici CMP" } as const;

/** Proof lookup: a visitor reads their id from the preferences dialog; staff find every choice made under it. */
export function ConsentRecordsCard() {
  const [query, setQuery] = useState({ visitorId: "", page: 1 });
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ rows: ConsentRecordRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    consentApi.admin.records({ visitorId: query.visitorId || undefined, page: query.page, pageSize: PAGE_SIZE })
      .then((r) => { if (live) { setData(r.data); setError(null); } })
      .catch((err) => { if (live) setError(errorMessage(err, "Kayıtlar yüklenemedi.")); });
    return () => { live = false; };
  }, [query]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <AdminCard className="max-w-6xl">
      <AdminCardTitle title="Onay kayıtları" subtitle="Her tercih değiştirilemez şekilde saklanır (KVKK ispatı). IP adresi yalnız özet olarak tutulur." />
      <form className="flex flex-wrap gap-2 px-5 pt-4" onSubmit={(e) => { e.preventDefault(); setQuery({ visitorId: search.trim(), page: 1 }); }}>
        <label htmlFor="consent-visitor" className="sr-only">Ziyaretçi kimliği</label>
        <input id="consent-visitor" className={`${inputCls} max-w-md flex-1`} placeholder="Ziyaretçi kimliği ile ara" value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        <button type="submit" className={btn}><Search className="mr-1.5 h-4 w-4" />Ara</button>
        {query.visitorId && <button type="button" className={btn} onClick={() => { setSearch(""); setQuery({ visitorId: "", page: 1 }); }}>Temizle</button>}
      </form>
      {error ? (
        <p className="px-5 py-6 text-sm text-red-600">{error}</p>
      ) : !data ? (
        <p className="px-5 py-6 text-sm text-slate-500">Yükleniyor…</p>
      ) : data.rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">{query.visitorId ? "Bu kimlikle kayıtlı tercih yok." : "Henüz tercih kaydı yok. Ziyaretçiler banner'da seçim yaptıkça burada görünür."}</p>
      ) : (
        <AdminTable className="mt-4">
          <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-5 py-2 font-medium">Zaman</th><th className="px-3 py-2 font-medium">Ziyaretçi</th><th className="px-3 py-2 font-medium">Müşteri</th><th className="px-3 py-2 font-medium">Seçim</th><th className="px-3 py-2 font-medium">İzinler</th><th className="px-3 py-2 font-medium">Kaynak</th><th className="px-3 py-2 font-medium">Revizyon</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-5 py-2.5 text-slate-700">{dt.format(new Date(r.recordedAt))}</td>
                <td className="px-3 py-2.5"><button type="button" className="font-mono text-xs text-[#7367f0] hover:underline" onClick={() => { setSearch(r.visitorId); setQuery({ visitorId: r.visitorId, page: 1 }); }}>{r.visitorId.slice(0, 8)}…</button></td>
                <td className="px-3 py-2.5 text-slate-700">{r.customerEmail ?? <span className="text-slate-400">Misafir</span>}</td>
                <td className="px-3 py-2.5"><AdminBadge tone={ACTION[r.action].tone}>{ACTION[r.action].label}</AdminBadge></td>
                <td className="px-3 py-2.5 text-xs text-slate-600">
                  {[r.choices.functional && "İşlevsel", r.choices.analytics && "Analitik", r.choices.marketing && "Pazarlama"].filter(Boolean).join(", ") || "Yalnız zorunlu"}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{SOURCE[r.source]}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{r.revision}</td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      )}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-sm text-slate-600">
          <span>{data.total.toLocaleString("tr-TR")} kayıt · sayfa {query.page}/{pages}</span>
          <div className="flex gap-2">
            <button type="button" className={btn} disabled={query.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>Önceki</button>
            <button type="button" className={btn} disabled={query.page >= pages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>Sonraki</button>
          </div>
        </div>
      )}
    </AdminCard>
  );
}
