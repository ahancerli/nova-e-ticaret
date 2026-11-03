"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Ban, BadgeCheck, KeyRound, LogOut, MapPin, Save, UserCheck } from "lucide-react";
import { notify } from "@/lib/toast";
import { formatMinor } from "@/lib/money";
import { useFieldErrors } from "@/lib/use-field-errors";
import { orderStatusMeta, paymentStatusMeta } from "@/lib/order-rules";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { OneTimeLinkDialog } from "@/components/admin/OneTimeLinkDialog";
import { Counter, Field, inputCls } from "@/components/admin/form";
import type { CustomerAction, CustomerDetail } from "@/modules/customers";
import { customersApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const day = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });
const fmt = (iso: string | null, empty = "—") => (iso ? dt.format(new Date(iso)) : empty);

const CONFIRM: Partial<Record<CustomerAction, { title: string; description: string; label: string; tone: "danger" | "primary" }>> = {
  suspend: { title: "Hesap askıya alınsın mı?", description: "Müşteri mağazaya giriş yapamaz, açık oturumları kapatılır. Siparişleri ve kayıtları korunur.", label: "Askıya al", tone: "danger" },
  revoke_sessions: { title: "Tüm oturumlar kapatılsın mı?", description: "Müşteri bütün cihazlarda oturumdan çıkarılır.", label: "Oturumları kapat", tone: "primary" },
};
const DONE: Partial<Record<CustomerAction, string>> = { suspend: "Hesap askıya alındı", reactivate: "Hesap yeniden etkinleştirildi", revoke_sessions: "Oturumlar kapatıldı" };

/** One member: totals, orders, profile (+ internal note), addresses, consent history and account actions. */
export function CustomerDetailView({ customer: c, canWrite }: { customer: CustomerDetail; canWrite: boolean }) {
  const router = useRouter();
  const initial = useMemo(() => ({ firstName: c.firstName, lastName: c.lastName, phone: c.phone ?? "", companyName: c.companyName ?? "", notes: c.notes ?? "" }), [c]);
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<CustomerAction | null>(null);
  const [confirm, setConfirm] = useState<CustomerAction | null>(null);
  const [link, setLink] = useState<{ path: string; expiresAt: string } | null>(null);
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    errors.clear();
    try {
      await customersApi.update(c.id, { ...f, phone: f.phone || null, companyName: f.companyName || null, notes: f.notes || null });
      notify.success("Müşteri güncellendi");
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setSaving(false);
    }
  };

  const run = async (action: CustomerAction) => {
    setBusy(action);
    try {
      const r = await customersApi.action(c.id, action);
      setConfirm(null);
      if (r.data.link) setLink(r.data.link);
      else notify.success(DONE[action] ?? "İşlem tamamlandı");
      router.refresh();
    } catch (err) {
      notify.error(err);
      setConfirm(null);
    } finally {
      setBusy(null);
    }
  };
  const ask = (a: CustomerAction) => (CONFIRM[a] ? setConfirm(a) : run(a));
  const btn = "inline-flex min-h-10 w-full items-center gap-2 rounded-lg border border-slate-200 px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

  const tiles = [
    { label: "Sipariş", value: c.orderCount.toLocaleString("tr-TR"), hint: `${c.stats.paidOrderCount} ödemesi alınan` },
    { label: "Toplam harcama", value: formatMinor(c.totalSpentMinor), hint: c.stats.refundedMinor ? `${formatMinor(c.stats.refundedMinor)} iade edildi` : "Tahsil edilen" },
    { label: "Ortalama sepet", value: formatMinor(c.stats.averageOrderMinor), hint: "Ödemesi alınan sipariş başına" },
    { label: "Son sipariş", value: c.lastOrderAt ? day.format(new Date(c.lastOrderAt)) : "—", hint: c.stats.firstOrderAt ? `İlk: ${day.format(new Date(c.stats.firstOrderAt))}` : "Henüz sipariş yok" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/musteriler" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Müşteriler</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{c.name}</h1>
          <AdminBadge tone={c.status === "active" ? "green" : "slate"}>{c.status === "active" ? "Aktif" : "Askıda"}</AdminBadge>
          {c.emailVerified ? <AdminBadge tone="blue">E-posta doğrulandı</AdminBadge> : null}
        </div>
        <p className="mt-1 text-sm text-slate-500">{c.email}{c.phone ? ` · ${c.phone}` : ""} · Üyelik {day.format(new Date(c.createdAt))}</p>
      </div>

      <section aria-label="Özet" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">{t.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{t.value}</p>
            <p className="mt-1 text-xs text-slate-500">{t.hint}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <AdminCard>
            <AdminCardTitle title="Siparişler" subtitle={c.orderCount > c.orders.length ? `Son ${c.orders.length} sipariş` : undefined} />
            {c.orders.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Bu müşterinin henüz siparişi yok.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="px-5 py-2.5 font-medium">Sipariş</th><th className="px-3 py-2.5 font-medium">Durum</th><th className="px-5 py-2.5 text-right font-medium">Tutar</th></tr></thead>
                  <tbody>
                    {c.orders.map((o) => (
                      <tr key={o.id} className="border-t border-slate-100">
                        <td className="px-5 py-3"><Link href={`/admin/siparisler/${o.id}`} className="font-semibold text-[#7367f0] hover:underline">#{o.orderNumber}</Link><p className="text-xs text-slate-500">{fmt(o.placedAt)}</p></td>
                        <td className="px-3 py-3"><AdminBadge tone={orderStatusMeta(o.status).tone}>{orderStatusMeta(o.status).label}</AdminBadge><p className="mt-1 text-xs text-slate-500">Ödeme: {paymentStatusMeta(o.paymentStatus).label}</p></td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">{formatMinor(o.totalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>

          <form onSubmit={save} noValidate>
            <AdminCard>
              <AdminCardTitle title="Profil" subtitle={canWrite ? "E-posta giriş kimliğidir; müşteri adına değiştirilmez." : "Düzenlemek için “Müşteri hesaplarını yönetme” yetkisi gerekir."} />
              <fieldset disabled={!canWrite} className="grid gap-4 p-5 sm:grid-cols-2">
                <Field id="cu-first" label="Ad" required error={fe("firstName")}><input id="cu-first" className={inputCls} value={f.firstName} maxLength={80} onChange={(e) => set({ firstName: e.target.value })} /></Field>
                <Field id="cu-last" label="Soyad" error={fe("lastName")}><input id="cu-last" className={inputCls} value={f.lastName} maxLength={80} onChange={(e) => set({ lastName: e.target.value })} /></Field>
                <Field id="cu-phone" label="Telefon" error={fe("phone")}><input id="cu-phone" type="tel" className={inputCls} value={f.phone} maxLength={20} onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!fe("phone")} /></Field>
                <Field id="cu-company" label="Firma" error={fe("companyName")}><input id="cu-company" className={inputCls} value={f.companyName} maxLength={160} onChange={(e) => set({ companyName: e.target.value })} /></Field>
                <Field id="cu-notes" label="İç not" error={fe("notes")} hint={<span className="flex justify-between"><span>Yalnız ekip görür.</span><Counter value={f.notes} max={2000} /></span>} className="sm:col-span-2">
                  <textarea id="cu-notes" className={`${inputCls} min-h-24 py-2`} value={f.notes} maxLength={2000} onChange={(e) => set({ notes: e.target.value })} />
                </Field>
              </fieldset>
              {canWrite ? (
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                  <button type="button" disabled={!dirty || saving} onClick={() => setF(initial)} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Değişiklikleri geri al</button>
                  <button type="submit" disabled={!dirty || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60"><Save className="size-4" />{saving ? "Bekleyin…" : "Güncelle"}</button>
                </div>
              ) : null}
            </AdminCard>
          </form>

          <AdminCard>
            <AdminCardTitle title="Adresler" />
            {c.addresses.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">Kayıtlı adres yok.</p> : (
              <ul className="grid gap-3 p-5 sm:grid-cols-2">
                {c.addresses.map((a) => (
                  <li key={a.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-800"><MapPin className="size-4 text-slate-400" aria-hidden />{a.label}
                      {a.isDefaultShipping ? <AdminBadge tone="blue">Teslimat</AdminBadge> : null}{a.isDefaultBilling ? <AdminBadge tone="purple">Fatura</AdminBadge> : null}</p>
                    <p className="mt-2 text-slate-600">{a.recipientName} · {a.phone}</p>
                    <p className="text-slate-600">{a.line1}, {a.district} / {a.province}</p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          {canWrite ? (
            <AdminCard>
              <AdminCardTitle title="Hesap" />
              <div className="space-y-2 p-5">
                {c.status === "active" ? (
                  <>
                    <button type="button" className={btn} disabled={!!busy} onClick={() => ask("password_reset")}><KeyRound className="size-4" />Parola sıfırlama bağlantısı</button>
                    <button type="button" className={btn} disabled={!!busy || c.activeSessions === 0} onClick={() => ask("revoke_sessions")}><LogOut className="size-4" />Oturumları kapat ({c.activeSessions})</button>
                    <button type="button" className={`${btn} text-red-600`} disabled={!!busy} onClick={() => ask("suspend")}><Ban className="size-4" />Askıya al</button>
                  </>
                ) : (
                  <button type="button" className={btn} disabled={!!busy} onClick={() => ask("reactivate")}><UserCheck className="size-4" />Yeniden etkinleştir</button>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 p-5 text-xs">
                <div><dt className="text-slate-500">Son giriş</dt><dd className="mt-0.5 font-medium text-slate-800">{fmt(c.lastLoginAt, "Hiç")}</dd></div>
                <div><dt className="text-slate-500">Parola değişimi</dt><dd className="mt-0.5 font-medium text-slate-800">{fmt(c.passwordChangedAt)}</dd></div>
              </dl>
            </AdminCard>
          ) : null}

          <AdminCard>
            <AdminCardTitle title="İzinler ve onaylar" subtitle="KVKK ve ticari ileti (İYS) kayıtları, en yenisi üstte." />
            {c.consents.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500">Kayıt yok.</p> : (
              <ul className="divide-y divide-slate-100">
                {c.consents.map((x, i) => (
                  <li key={`${x.purpose}-${x.recordedAt}-${i}`} className="flex items-start gap-3 px-5 py-3 text-sm">
                    <BadgeCheck className={`mt-0.5 size-4 flex-none ${x.granted && !x.withdrawnAt ? "text-emerald-600" : "text-slate-300"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-800">{x.label}</span>
                      <span className="block text-xs text-slate-500">{x.withdrawnAt ? `Geri çekildi ${fmt(x.withdrawnAt)}` : x.granted ? "Onay verdi" : "Onay vermedi"} · {fmt(x.recordedAt)} · sürüm {x.version}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>

      {confirm && CONFIRM[confirm] ? (
        <AdminConfirmDialog open title={CONFIRM[confirm]!.title} description={CONFIRM[confirm]!.description} confirmLabel={CONFIRM[confirm]!.label}
          tone={CONFIRM[confirm]!.tone} busy={busy === confirm} onConfirm={() => run(confirm)} onCancel={() => setConfirm(null)} />
      ) : null}
      <OneTimeLinkDialog link={link} title="Parola sıfırlama bağlantısı" recipient={c.name} onClose={() => setLink(null)} />
    </div>
  );
}
