"use client";

import { useState, useSyncExternalStore } from "react";
import { CalendarClock, Plus, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Field, inputCls } from "@/components/admin/form";
import { AdminCard, AdminCardTitle } from "@/components/admin/ui";
import {
  MAX_HOLIDAYS, WEEKDAYS, deliveryPromise, durationLabel, formatCutoff, formatDay, isDay, type DeliverySettings,
} from "@/modules/delivery/domain/delivery";

const primary = "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";

const toTime = (m: number) => formatCutoff(m);
const everyMinute = (l: () => void) => { const t = setInterval(l, 60_000); return () => clearInterval(t); };
const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const fromTime = (v: string) => { const [h, m] = v.split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h! * 60 + m! : NaN; };

/**
 * Tahmini teslim: rules behind the product page line "X saat içinde sipariş verirsen bugün kargoda · Tahmini teslim
 * 19–21 Kasım". The preview runs the same calculation as the shop for the current moment.
 */
export function DeliverySettingsCard({ initial }: { initial: DeliverySettings }) {
  const errors = useFieldErrors();
  const [saved, setSaved] = useState(initial);
  const [f, setF] = useState({ ...initial, cutoff: toTime(initial.cutoffMinutes), holiday: "" });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const cutoffMinutes = fromTime(f.cutoff);
  const rules = { enabled: f.enabled, cutoffMinutes: Number.isNaN(cutoffMinutes) ? 0 : cutoffMinutes, shipDays: f.shipDays, handlingDays: Number(f.handlingDays) || 0, transitMinDays: Number(f.transitMinDays) || 1, transitMaxDays: Math.max(Number(f.transitMaxDays) || 1, Number(f.transitMinDays) || 1), holidays: f.holidays };
  // Client clock only (null on the server render), so the preview never mismatches during hydration.
  const now = useSyncExternalStore(everyMinute, thisMinute, () => null);
  const preview = now == null ? null : deliveryPromise({ ...rules, enabled: true }, new Date(now));

  const toggleDay = (d: number) => set({ shipDays: f.shipDays.includes(d) ? f.shipDays.filter((x) => x !== d) : [...f.shipDays, d].sort() });
  const addHoliday = () => {
    if (!isDay(f.holiday)) { errors.set({ holidays: ["Bir tarih seçin."] }); return; }
    errors.clear("holidays");
    if (!f.holidays.includes(f.holiday)) set({ holidays: [...f.holidays, f.holiday].sort(), holiday: "" });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    errors.clear();
    if (Number.isNaN(cutoffMinutes)) { errors.set({ cutoffMinutes: ["Saati seçin."] }); return; }
    setBusy(true);
    try {
      const r = (await api<DeliverySettings>("/api/admin/delivery-settings", {
        method: "PUT",
        json: {
          enabled: f.enabled, cutoffMinutes, shipDays: f.shipDays, handlingDays: f.handlingDays, transitMinDays: f.transitMinDays, transitMaxDays: f.transitMaxDays,
          holidays: f.holidays, expectedUpdatedAt: saved.updatedAt,
        },
      })).data;
      setSaved(r);
      setF({ ...r, cutoff: toTime(r.cutoffMinutes), holiday: "" });
      notify.success("Teslim tahmini güncellendi");
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Teslim tahmini kaydedilemedi." });
    } finally {
      setBusy(false);
    }
  };

  const num = (k: "handlingDays" | "transitMinDays" | "transitMaxDays") => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) });

  return (
    <AdminCard className="max-w-4xl">
      <AdminCardTitle title="Tahmini teslim" subtitle="Ürün sayfasında “bugün kargoda” ve tahmini teslim tarihini gösterir. Saatler Türkiye saatidir." />
      <form onSubmit={save} noValidate className="space-y-5 px-5 py-5">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" className="size-4 accent-[#7367f0]" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Ürün sayfasında göster
        </label>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="dl-cutoff" label="Aynı gün kargo için son saat" error={errors.get("cutoffMinutes")} className="sm:col-span-1">
            <input id="dl-cutoff" type="time" className={`${inputCls} h-10`} value={f.cutoff} onChange={(e) => set({ cutoff: e.target.value })} />
          </Field>
          <Field id="dl-handling" label="Hazırlık süresi (gün)" error={errors.get("handlingDays")} hint="0 = son saatten önceki sipariş aynı gün çıkar.">
            <input id="dl-handling" type="number" min={0} max={10} className={`${inputCls} h-10`} value={f.handlingDays} onChange={num("handlingDays")} />
          </Field>
          <Field id="dl-min" label="Kargo süresi en az (gün)" error={errors.get("transitMinDays")}>
            <input id="dl-min" type="number" min={1} max={15} className={`${inputCls} h-10`} value={f.transitMinDays} onChange={num("transitMinDays")} />
          </Field>
          <Field id="dl-max" label="Kargo süresi en çok (gün)" error={errors.get("transitMaxDays")}>
            <input id="dl-max" type="number" min={1} max={20} className={`${inputCls} h-10`} value={f.transitMaxDays} onChange={num("transitMaxDays")} />
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-medium text-slate-600">Kargoya verilen günler</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((label, i) => {
              const on = f.shipDays.includes(i + 1);
              return (
                <button key={label} type="button" aria-pressed={on} onClick={() => toggleDay(i + 1)}
                  className={`h-9 rounded-lg px-3 text-sm font-medium transition ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>
              );
            })}
          </div>
          {errors.get("shipDays") ? <p className="mt-1 text-xs text-red-600">{errors.get("shipDays")}</p> : <p className="mt-1 text-xs text-slate-500">Teslimat Pazartesi–Cumartesi yapılır; Pazar ve tatil günleri sayılmaz.</p>}
        </fieldset>

        <div>
          <span className="mb-2 block text-xs font-medium text-slate-600">Tatil günleri (kargo çıkmaz)</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {f.holidays.map((d) => (
              <span key={d} className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 pl-2.5 pr-1 text-sm text-slate-700">
                {formatDay(d)} {d.slice(0, 4)}
                <button type="button" aria-label={`${formatDay(d)} tatilini kaldır`} onClick={() => set({ holidays: f.holidays.filter((x) => x !== d) })} className="grid size-6 place-items-center rounded hover:bg-slate-200"><X className="size-3.5" /></button>
              </span>
            ))}
            <input type="date" aria-label="Tatil günü" className={`${inputCls} h-9 w-auto`} value={f.holiday} onChange={(e) => set({ holiday: e.target.value })} />
            <button type="button" onClick={addHoliday} disabled={f.holidays.length >= MAX_HOLIDAYS} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Plus className="size-4" /> Ekle
            </button>
          </div>
          {errors.get("holidays") ? <p className="mt-1 text-xs text-red-600">{errors.get("holidays")}</p> : null}
        </div>

        <div className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <CalendarClock className="mt-0.5 size-5 flex-none text-[#7367f0]" />
          <p>
            <span className="font-medium">Şu an sipariş verilse: </span>
            {preview
              ? <>{preview.orderWithinMinutes != null ? `${durationLabel(preview.orderWithinMinutes)} içinde sipariş verirsen ` : "Şimdi sipariş verirsen "}<b>{preview.shipLabel} kargoda</b> · tahmini teslim <b>{preview.deliveryLabel}</b></>
              : now == null ? "…" : "Kargo günü seçilmedi; ürün sayfasında gösterilmez."}
            {!f.enabled ? <span className="block text-xs text-slate-500">Şu an kapalı: ürün sayfasında görünmüyor.</span> : null}
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={primary}>{busy ? "Güncelleniyor…" : "Güncelle"}</button>
        </div>
      </form>
    </AdminCard>
  );
}
