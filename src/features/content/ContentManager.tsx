"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, ExternalLink, FilePlus2, Plus } from "lucide-react";
import { notify } from "@/lib/toast";
import { DataGrid, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { FOOTER_COLUMNS, LEGAL_TYPES, LEGAL_TYPE_KEYS, PAGE_KINDS, PAGE_STATUSES, pageHref, type PageKind, type PageSummary } from "@/modules/content/domain/page";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const TABS: { key: "all" | PageKind; label: string }[] = [{ key: "all", label: "Tümü" }, ...(Object.entries(PAGE_KINDS) as [PageKind, string][]).map(([key, label]) => ({ key, label }))];

/** İçerik yönetimi: legal-text checklist + every page (row → editor). */
export function ContentManager({ pages, highlightId }: { pages: PageSummary[]; highlightId: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | PageKind>("all");

  useEffect(() => {
    if (!highlightId) return;
    const p = pages.find((x) => x.id === highlightId);
    if (p) notify.success("Sayfa kaydedildi", { id: `page-saved-${highlightId}-${p.version}`, description: p.title });
    window.history.replaceState(null, "", window.location.pathname);
  }, [highlightId, pages]);

  const rows = useMemo(() => (tab === "all" ? pages : pages.filter((p) => p.kind === tab)), [pages, tab]);
  const counts = useMemo(() => pages.reduce<Record<string, number>>((a, p) => ({ ...a, [p.kind]: (a[p.kind] ?? 0) + 1 }), {}), [pages]);

  const columns = useMemo<GridColumn<PageSummary>[]>(() => [
    {
      colId: "title", field: "title", headerName: "Sayfa", flex: 1, minWidth: 260, sortable: true,
      cellRenderer: (p: { data?: PageSummary }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="font-medium text-slate-800">{p.data.title}</span>
          <span className="font-mono text-xs text-slate-400">{pageHref(p.data.slug)}</span>
        </span>
      ) : null,
    },
    {
      colId: "kind", field: "kind", headerName: "Tür", minWidth: 190, sortable: true,
      valueFormatter: (p) => (p.data?.legalType ? LEGAL_TYPES[p.data.legalType].label : PAGE_KINDS[p.value as PageKind] ?? ""),
    },
    {
      colId: "status", field: "status", headerName: "Durum", minWidth: 120, sortable: true,
      cellRenderer: (p: { data?: PageSummary }) => p.data ? <AdminBadge tone={PAGE_STATUSES[p.data.status].tone}>{PAGE_STATUSES[p.data.status].label}</AdminBadge> : null,
    },
    { colId: "footer", field: "footerColumn", headerName: "Footer", minWidth: 120, valueFormatter: (p) => (p.value ? FOOTER_COLUMNS[p.value as keyof typeof FOOTER_COLUMNS] : "—") },
    { colId: "version", field: "version", headerName: "Sürüm", width: 100, sortable: true, valueFormatter: (p) => `v${p.value}` },
    {
      colId: "updatedAt", field: "updatedAt", headerName: "Son güncelleme", minWidth: 200, sortable: true,
      // Single-line values stay plain text so the grid centres them like the other cells.
      cellRenderer: (p: { data?: PageSummary }) => !p.data ? null : p.data.updatedByName ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="text-slate-700">{dt.format(new Date(p.data.updatedAt))}</span>
          <span className="text-xs text-slate-400">{p.data.updatedByName}</span>
        </span>
      ) : dt.format(new Date(p.data.updatedAt)),
    },
  ], []);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="İçerik yönetimi"
        subtitle="Yasal metinler, kurumsal ve yardım sayfaları. Yayındaki sayfalar seçtiğiniz footer sütununda otomatik görünür."
        actions={
          <Link href="/admin/icerik/yeni" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:-translate-y-px hover:bg-[#6559df]">
            <Plus className="h-4 w-4" />
            Sayfa ekle
          </Link>
        }
      />

      <LegalChecklist pages={pages} />

      <AdminCard className="overflow-hidden">
        <div role="tablist" aria-label="Sayfa türü" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2 sm:px-4">
          {TABS.map((t) => {
            const on = t.key === tab;
            const n = t.key === "all" ? pages.length : counts[t.key] ?? 0;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm transition-colors ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                {t.label}
                <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>{n}</span>
                <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
              </button>
            );
          })}
        </div>
        <DataGrid<PageSummary>
          columns={columns}
          rows={rows}
          getRowId={(p) => p.id}
          onRowClick={(p) => router.push(`/admin/icerik/${p.id}`)}
          highlightRowId={highlightId}
          stateKey="admin-content"
          exportFileName="icerik-sayfalari"
          searchPlaceholder="Başlık veya adres ara"
          emptyText="Bu türde sayfa yok."
          height={520}
        />
      </AdminCard>
    </div>
  );
}

/** One row per legal document type: published (version) / draft / missing → create from template. */
function LegalChecklist({ pages }: { pages: PageSummary[] }) {
  const byType = new Map(pages.filter((p) => p.legalType && p.status !== "archived").map((p) => [p.legalType!, p]));
  const missingRequired = LEGAL_TYPE_KEYS.filter((t) => LEGAL_TYPES[t].required && byType.get(t)?.status !== "published");

  return (
    <AdminCard>
      <AdminCardTitle
        title="Yasal metinler"
        subtitle="Türkiye'de e-ticaret için gereken sözleşme ve bilgilendirme metinleri. Firma bilgileri Site ayarları'ndan otomatik doldurulur."
        actions={missingRequired.length
          ? <AdminBadge tone="amber">{missingRequired.length} zorunlu metin yayında değil</AdminBadge>
          : <AdminBadge tone="green">Zorunlu metinler yayında</AdminBadge>}
      />
      <ul className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
        {LEGAL_TYPE_KEYS.map((type) => {
          const meta = LEGAL_TYPES[type];
          const page = byType.get(type);
          const Icon = page?.status === "published" ? CheckCircle2 : meta.required ? CircleAlert : CircleDashed;
          const tone = page?.status === "published" ? "text-emerald-600" : meta.required ? "text-amber-500" : "text-slate-400";
          return (
            <li key={type} className="flex items-start gap-3 bg-white px-5 py-4">
              <Icon className={`mt-0.5 size-5 flex-none ${tone}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{meta.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {page ? `${PAGE_STATUSES[page.status].label} · v${page.version}` : meta.required ? "Eksik — zorunlu" : "Eksik — isteğe bağlı"}
                  {meta.checkout ? " · ödeme adımında onaylatılır" : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
                  {page ? (
                    <>
                      <Link href={`/admin/icerik/${page.id}`} className="text-[#7367f0] hover:underline">Düzenle</Link>
                      {page.status === "published" ? (
                        <a href={pageHref(page.slug)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">Sitede gör<ExternalLink className="size-3" /></a>
                      ) : null}
                    </>
                  ) : (
                    <Link href={`/admin/icerik/yeni?tur=${type}`} className="inline-flex items-center gap-1 text-[#7367f0] hover:underline"><FilePlus2 className="size-3.5" />Şablondan oluştur</Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </AdminCard>
  );
}
