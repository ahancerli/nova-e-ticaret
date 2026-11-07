"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { BadgeCheck, CheckCircle2, MessageSquareReply, Settings2, Star, TriangleAlert } from "lucide-react";
import { notify } from "@/lib/toast";
import { DataGrid, type FetchPage, type GridColumn } from "@/components/ui/DataGrid";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { ADMIN_REVIEW_SORTS, CONTACT_STATUSES, REVIEW_TABS, type RejectReason, type ReviewStats, type ReviewSummaryRow, type ReviewTab } from "@/modules/reviews/domain/review";
import { reviewsApi } from "./api";
import { RejectDialog } from "./RejectDialog";
import { ReviewDrawer } from "./ReviewDrawer";
import { ReviewSettingsDrawer } from "./ReviewSettingsDrawer";
import { Stars, StatusBadge, dateTime } from "./ui";

const SORTABLE = new Set<string>(ADMIN_REVIEW_SORTS);
const isTab = (v: string | null): v is ReviewTab => !!v && v in REVIEW_TABS;

/**
 * Ürün yorumları: moderation queue (tabs with counts, star filter, search), bulk publish / reject, detail drawer with
 * reply and customer contact. `?durum=` picks the tab, `?yorum=<id>` opens a review (links from notifications).
 */
export function ReviewsManager() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<ReviewTab>(isTab(params.get("durum")) ? (params.get("durum") as ReviewTab) : "pending");
  const [rating, setRating] = useState<number | null>(null);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ReviewSummaryRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(params.get("yorum"));
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deep links from the notification bell change the query while this page stays mounted.
  const linked = params.get("yorum");
  const [seenLink, setSeenLink] = useState(linked);
  if (linked !== seenLink) {
    setSeenLink(linked);
    if (linked) setOpenId(linked);
  }

  const fetchPage = useCallback<FetchPage<ReviewSummaryRow>>(async ({ offset, limit, sort, search }) => {
    const q = new URLSearchParams({ page: String(Math.floor(offset / limit) + 1), pageSize: String(limit), tab });
    if (rating) q.set("rating", String(rating));
    if (sort && SORTABLE.has(sort.colId)) { q.set("sort", sort.colId); q.set("dir", sort.sort); }
    if (search) q.set("q", search);
    try {
      const r = await reviewsApi.list(q.toString());
      setStats((r.meta.stats as ReviewStats | undefined) ?? null);
      return { rows: r.data, total: Number(r.meta.total ?? 0) };
    } catch (err) {
      notify.error(err, { id: "reviews-load", fallback: "Yorumlar yüklenemedi." });
      throw err;
    }
  }, [tab, rating]);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeDrawer = useCallback(() => {
    setOpenId(null);
    if (linked) router.replace("/admin/yorumlar", { scroll: false });
  }, [linked, router]);

  const bulk = async (action: "approve" | "reject", reason?: RejectReason, note?: string | null) => {
    setBusy(true);
    try {
      const r = (await reviewsApi.moderate({ ids: selected.map((s) => s.id), action, reason, note })).data;
      notify.success(action === "approve" ? `${r.changed} yorum yayınlandı` : `${r.changed} yorum reddedildi`, r.skipped ? { description: `${r.skipped} yorum durumu uygun olmadığı için atlandı.` } : undefined);
      setRejecting(false);
      reload();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo<GridColumn<ReviewSummaryRow>[]>(() => [
    {
      colId: "product_name", field: "productName", headerName: "Ürün", minWidth: 240, flex: 1, sortable: true, pinned: "left",
      cellRenderer: (p: { data?: ReviewSummaryRow }) => p.data ? (
        <span className="flex h-full items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- R2 / demo asset */}
          <img src={p.data.productImageUrl ?? "/demo/placeholder.svg"} alt="" className="size-9 flex-none rounded-lg border border-slate-200 bg-white object-contain p-0.5" />
          <span className="truncate font-medium text-slate-800">{p.data.productName}</span>
        </span>
      ) : null,
    },
    {
      colId: "rating", field: "rating", headerName: "Puan", width: 120, sortable: true, cellClass: "flex items-center",
      cellRenderer: (p: { data?: ReviewSummaryRow }) => (p.data ? <Stars value={p.data.rating} /> : null),
    },
    {
      colId: "body", headerName: "Yorum", minWidth: 320, flex: 2,
      cellRenderer: (p: { data?: ReviewSummaryRow }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          {p.data.title ? <span className="truncate font-medium text-slate-800">{p.data.title}</span> : null}
          <span className="truncate text-xs text-slate-500">{p.data.body}</span>
        </span>
      ) : null,
    },
    {
      colId: "customer", headerName: "Müşteri", minWidth: 190,
      cellRenderer: (p: { data?: ReviewSummaryRow }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="flex items-center gap-1 text-slate-700">{p.data.customerName}{p.data.verifiedPurchase ? <BadgeCheck className="size-3.5 text-emerald-600" aria-label="Satın aldı" /> : null}</span>
          <span className="text-[11px] text-slate-400">{p.data.isAnonymous ? "İsmi gizli yayınlanır" : p.data.verifiedPurchase ? "Doğrulanmış alıcı" : "Üye"}</span>
        </span>
      ) : null,
    },
    {
      colId: "status", field: "status", headerName: "Durum", minWidth: 150, cellClass: "flex items-center",
      cellRenderer: (p: { data?: ReviewSummaryRow }) => p.data ? (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={p.data.status} />
          {p.data.hasReply ? <MessageSquareReply className="size-4 text-[#7367f0]" aria-label="Mağaza yanıtladı" /> : null}
        </span>
      ) : null,
    },
    { colId: "contact", field: "contactStatus", headerName: "İletişim", minWidth: 140, valueFormatter: (p) => CONTACT_STATUSES[p.value as keyof typeof CONTACT_STATUSES] ?? "" },
    { colId: "helpful_count", field: "helpfulCount", headerName: "Faydalı", width: 110, sortable: true, type: "rightAligned" },
    { colId: "created_at", field: "createdAt", headerName: "Tarih", minWidth: 160, sortable: true, sort: "desc", valueFormatter: (p) => (p.value ? dateTime.format(new Date(p.value)) : "") },
  ], []);

  const pendingSelected = selected.length > 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Ürün yorumları" subtitle="Müşteri yorumları siz yayınlayana kadar mağazada görünmez. Yanıt verin, gerekirse müşteriyle iletişime geçin."
        actions={
          <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
            <Settings2 className="size-4" /> Yorum ayarları
          </button>
        } />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={TriangleAlert} tone="amber" label="Onay bekleyen" value={stats ? String(stats.counts.pending) : "–"}
          hint={stats?.lowRatingPending ? `${stats.lowRatingPending} tanesi 1–2 yıldız` : "Sırada düşük puanlı yorum yok"} onClick={() => setTab("pending")} />
        <StatTile icon={Star} tone="violet" label="Ortalama puan" value={stats?.average != null ? stats.average.toFixed(2).replace(".", ",") : "–"} hint="Yayındaki yorumlar" />
        <StatTile icon={CheckCircle2} tone="green" label="Yayında" value={stats ? String(stats.counts.approved) : "–"} hint="Mağazada görünen" onClick={() => setTab("approved")} />
        <StatTile icon={MessageSquareReply} tone="slate" label="Toplam yorum" value={stats ? String(stats.counts.all) : "–"} hint={stats ? `${stats.counts.rejected} reddedildi · ${stats.counts.hidden} kaldırıldı` : ""} onClick={() => setTab("all")} />
      </div>

      <AdminCard className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 px-3 pt-2 sm:px-4">
          <div role="tablist" aria-label="Yorum durumu" className="no-scrollbar flex gap-1 overflow-x-auto">
            {(Object.entries(REVIEW_TABS) as [ReviewTab, string][]).map(([key, label]) => {
              const on = key === tab;
              return (
                <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setTab(key)}
                  className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                  {label}
                  <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-[#7367f0] text-white" : key === "pending" && stats?.counts.pending ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{stats?.counts[key] ?? "–"}</span>
                  <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
                </button>
              );
            })}
          </div>
          <div role="group" aria-label="Puana göre filtrele" className="flex items-center gap-1 pb-2">
            {[null, 5, 4, 3, 2, 1].map((r) => (
              <button key={r ?? "all"} type="button" aria-pressed={rating === r} onClick={() => setRating(r)}
                className={`inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition ${rating === r ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {r == null ? "Tüm puanlar" : <>{r}<Star className={`size-3 ${rating === r ? "fill-white" : "fill-amber-400 text-amber-400"}`} aria-hidden /></>}
              </button>
            ))}
          </div>
        </div>
        <DataGrid<ReviewSummaryRow>
          columns={columns} fetchPage={fetchPage} getRowId={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} highlightRowId={openId}
          selectable onSelectionChange={setSelected} refreshToken={refresh}
          stateKey="admin-reviews" exportFileName="urun-yorumlari" searchPlaceholder="Ürün, müşteri veya yorum ara" height={600}
          emptyText={tab === "pending" ? "Onay bekleyen yorum yok. 🎉" : "Bu filtrede yorum yok."}
          toolbarExtra={pendingSelected ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">{selected.length} seçili</span>
              <button type="button" disabled={busy} onClick={() => void bulk("approve")}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                <CheckCircle2 className="size-4" /> Yayınla
              </button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50">
                Yayınlama
              </button>
            </div>
          ) : null}
        />
      </AdminCard>

      <RejectDialog open={rejecting} count={selected.length} busy={busy} onCancel={() => setRejecting(false)} onSubmit={(reason, note) => void bulk("reject", reason, note)} />
      <ReviewDrawer id={openId} onClose={closeDrawer} onChanged={reload} />
      <ReviewSettingsDrawer open={settingsOpen} onClose={closeSettings} />
    </div>
  );
}

const TONES = {
  amber: "bg-amber-50 text-amber-600", violet: "bg-[#7367f0]/10 text-[#7367f0]", green: "bg-emerald-50 text-emerald-600", slate: "bg-slate-100 text-slate-600",
} as const;

function StatTile({ icon: Icon, tone, label, value, hint, onClick }: {
  icon: React.ComponentType<{ className?: string }>; tone: keyof typeof TONES; label: string; value: string; hint?: string; onClick?: () => void;
}) {
  const body = (
    <>
      <span className={`grid size-11 flex-none place-items-center rounded-xl ${TONES[tone]}`}><Icon className="size-5" /></span>
      <span className="min-w-0 text-left">
        <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <span className="block text-2xl font-semibold tabular-nums text-slate-900">{value}</span>
        {hint ? <span className="block truncate text-xs text-slate-500">{hint}</span> : null}
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  return onClick ? <button type="button" onClick={onClick} className={`${cls} transition hover:border-[#7367f0]/40 hover:shadow-md`}>{body}</button> : <div className={cls}>{body}</div>;
}
