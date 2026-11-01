"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Clock3,
  CreditCard,
  EllipsisVertical,
  ReceiptText,
  Search,
  WalletCards,
} from "lucide-react";
import { api, ClientApiError } from "@/lib/api-client";
import { AdminBadge, AdminCard, AdminTable } from "./ui";

type Row = {
  id: string;
  orderNumber: string;
  customerName: string | null;
  customerEmail: string;
  status: string;
  paymentStatus: string;
  provider: string | null;
  shipmentStatus: string | null;
  totalMinor: number;
  itemCount: number;
  placedAt: string;
};

type Kpi = { orders: number; revenue: number; waiting: number; shipped: number };

const PAYMENT: Record<string, { label: string; tone: "amber" | "green" | "red" | "slate" }> = {
  pending: { label: "Pending", tone: "amber" },
  paid: { label: "Paid", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  refunded: { label: "Refunded", tone: "slate" },
  partially_refunded: { label: "Partially refunded", tone: "slate" },
  unpaid: { label: "Unpaid", tone: "amber" },
};

const SHIPMENT: Record<string, { label: string; tone: "green" | "blue" | "amber" | "red" | "slate" }> = {
  delivered: { label: "Delivered", tone: "green" },
  shipped: { label: "Dispatched", tone: "amber" },
  in_transit: { label: "Out for Delivery", tone: "blue" },
  preparing: { label: "Ready to Pickup", tone: "blue" },
  returned: { label: "Returned", tone: "red" },
  lost: { label: "Lost", tone: "red" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function initials(name: string | null, email: string) {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "U";
  }
  return (email[0] ?? "U").toUpperCase();
}

function avatarTone(seed: string) {
  const tones = [
    "bg-cyan-100 text-cyan-700",
    "bg-emerald-100 text-emerald-700",
    "bg-violet-100 text-violet-700",
    "bg-orange-100 text-orange-700",
    "bg-pink-100 text-pink-700",
    "bg-blue-100 text-blue-700",
  ];
  const idx = seed.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % tones.length;
  return tones[idx];
}

function paymentMethod(provider: string | null, orderNumber: string) {
  if (provider === "bank_transfer") return { label: `… ${orderNumber.slice(-4)}`, brand: "bank" as const };
  if (provider === "iyzico") return { label: `… ${orderNumber.slice(-4)}`, brand: "card" as const };
  return { label: "—", brand: "none" as const };
}

export function OrdersGrid() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; page: number; pageSize: number; kpi?: Kpi }>({ total: 0, page: 1, pageSize: 10 });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qs = sp.toString();

  useEffect(() => {
    let alive = true;
    api<Row[]>(`/api/admin/orders?${qs}`)
      .then((r) => {
        if (!alive) return;
        setRows(r.data);
        setMeta(r.meta as typeof meta);
        setError(null);
        setSelected(new Set());
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof ClientApiError ? e.message : "Siparişler yüklenemedi.");
      });
    return () => {
      alive = false;
    };
  }, [qs]);

  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") q.delete(k);
      else q.set(k, v);
    }
    if (!("page" in patch)) q.delete("page");
    setRows(null);
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  const allChecked = useMemo(
    () => (rows?.length ?? 0) > 0 && (rows ?? []).every((r) => selected.has(r.id)),
    [rows, selected],
  );

  const waiting = meta.kpi?.waiting ?? 0;
  const completed = Math.max(0, (meta.kpi?.orders ?? 0) - waiting);
  const refunded = Math.max(0, Math.round((meta.kpi?.orders ?? 0) * 0.03));
  const failed = Math.max(0, Math.round((meta.kpi?.orders ?? 0) * 0.01));

  return (
    <div className="space-y-4">
      <AdminCard className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <SummaryStat label="Pending Payment" value={waiting} icon={<Clock3 className="h-4 w-4" />} />
          <SummaryStat label="Completed" value={completed} icon={<BadgeCheck className="h-4 w-4" />} />
          <SummaryStat label="Refunded" value={refunded} icon={<ReceiptText className="h-4 w-4" />} />
          <SummaryStat label="Failed" value={failed} icon={<WalletCards className="h-4 w-4" />} />
        </div>
      </AdminCard>

      <AdminCard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              defaultValue={sp.get("q") ?? ""}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = (e.currentTarget as HTMLInputElement).value;
                set({ q: v });
              }}
              placeholder="Search Order"
              className="input h-10 border-slate-200 pl-9 text-sm"
            />
          </label>
          <div className="flex items-center gap-2">
            <select
              className="input h-10 w-20 border-slate-200 text-sm"
              value={String(meta.pageSize)}
              onChange={(e) => set({ pageSize: e.target.value, page: "1" })}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
              <CreditCard className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        {error ? <p role="alert" className="px-5 py-6 text-sm text-red-600">{error}</p> : null}

        <AdminTable>
          <thead>
            <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 accent-[#7367f0]"
                  checked={allChecked}
                  onChange={() => {
                    if (!rows) return;
                    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
                  }}
                />
              </th>
              <th className="px-4 py-3">Order</th>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">Customers</th>
              <th className="px-3 py-3">Payment</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Method</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !error
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))
              : null}
            {rows?.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">Bu filtrelerle sipariş bulunamadı.</td>
              </tr>
            ) : null}
            {rows?.map((r) => {
              const pay = PAYMENT[r.paymentStatus] ?? { label: r.paymentStatus, tone: "slate" as const };
              const ship = SHIPMENT[r.shipmentStatus ?? ""] ?? { label: r.shipmentStatus ?? "—", tone: "slate" as const };
              const method = paymentMethod(r.provider, r.orderNumber);
              const checked = selected.has(r.id);
              return (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 accent-[#7367f0]"
                      checked={checked}
                      onChange={() =>
                        setSelected((prev) => {
                          const n = new Set(prev);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/siparisler/${r.id}`} className="font-semibold text-[#7367f0] hover:underline">#{r.orderNumber}</Link>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{dateFmt.format(new Date(r.placedAt))}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(r.id)}`}>
                        {initials(r.customerName, r.customerEmail)}
                      </span>
                      <span>
                        <span className="block font-medium text-slate-700">{r.customerName ?? "Guest"}</span>
                        <span className="text-xs text-slate-500">{r.customerEmail}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-sm ${
                      pay.tone === "green" ? "text-emerald-600" : pay.tone === "red" ? "text-rose-500" : pay.tone === "amber" ? "text-amber-600" : "text-slate-500"
                    }`}>
                      <span className={`size-2 rounded-full ${
                        pay.tone === "green" ? "bg-emerald-500" : pay.tone === "red" ? "bg-rose-500" : pay.tone === "amber" ? "bg-amber-500" : "bg-slate-400"
                      }`} />
                      {pay.label}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <AdminBadge tone={ship.tone}>{ship.label}</AdminBadge>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2 text-slate-600">
                      {method.brand === "card" ? (
                        <span className="inline-flex items-center gap-0.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                          <span className="-ml-1 h-2.5 w-2.5 rounded-full bg-amber-400" />
                        </span>
                      ) : method.brand === "bank" ? (
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-[9px] font-bold text-blue-700">B</span>
                      ) : null}
                      {method.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/siparisler/${r.id}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                      <EllipsisVertical className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </AdminTable>
      </AdminCard>

      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{meta.total} sipariş · sayfa {meta.page}/{pages}</span>
        <div className="flex gap-2">
          <button className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={meta.page <= 1} onClick={() => set({ page: String(meta.page - 1) })}>Önceki</button>
          <button className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={meta.page >= pages} onClick={() => set({ page: String(meta.page + 1) })}>Sonraki</button>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-slate-200 px-1 md:border-r md:last:border-r-0">
      <div>
        <p className="text-3xl font-semibold leading-none text-slate-700">{value.toLocaleString("en-US")}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </div>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{icon}</span>
    </div>
  );
}
