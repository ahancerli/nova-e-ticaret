"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CreditCard, KeyRound, Landmark, Pencil, Plus, ShieldCheck, Trash2, Zap } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import type { BankAccountView, IyzicoAccountView, IyzicoEnvironment, PaymentSettingsView } from "@/modules/payments";
import { IYZICO_ENV_LABEL, formatIban } from "@/modules/payments/domain/payment-settings";
import { paymentsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm font-medium text-slate-700 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="relative h-6 w-11 flex-none rounded-full bg-slate-200 transition peer-checked:bg-[#7367f0] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#7367f0] after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
      {label}
    </label>
  );
}

/**
 * Ödeme sistemleri: iyzico keys per environment (write-only, sealed on the server), which environment takes card
 * payments, Havale / EFT on/off and the bank accounts customers pay into.
 */
export function PaymentSettingsManager({ initial }: { initial: PaymentSettingsView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string, fallback: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      notify.success(ok);
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback });
    } finally {
      setBusy(null);
    }
  };

  const setCard = (env: IyzicoEnvironment | null) =>
    run("card", () => paymentsApi.setCard(env), env ? `Kartla ödeme açıldı (${IYZICO_ENV_LABEL[env]})` : "Kartla ödeme kapatıldı", "Kartla ödeme ayarı değiştirilemedi.");

  const cardOptions: { value: IyzicoEnvironment | null; label: string; disabled: boolean }[] = [
    { value: null, label: "Kapalı", disabled: false },
    ...initial.iyzico.accounts.map((a) => ({ value: a.environment, label: IYZICO_ENV_LABEL[a.environment], disabled: !a.configured })),
  ];
  const activeCard = initial.iyzico.active;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Ödeme sistemleri" subtitle="Mağazada hangi ödeme yöntemlerinin görüneceği, iyzico anahtarları ve havale için banka hesapları." />

      <AdminCard className="max-w-5xl">
        <AdminCardTitle title="Kart ile ödeme (iyzico)" subtitle="Müşteri iyzico'nun güvenli ödeme sayfasına yönlendirilir; kart bilgisi mağazaya gelmez."
          actions={activeCard ? <AdminBadge tone={activeCard === "production" ? "green" : "amber"}>Açık · {IYZICO_ENV_LABEL[activeCard]}</AdminBadge> : <AdminBadge>Kapalı</AdminBadge>} />
        <div className="space-y-5 px-5 py-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Ödemeleri alan ortam</p>
            <div role="radiogroup" aria-label="Kartla ödeme ortamı" className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5">
              {cardOptions.map((o) => {
                const on = activeCard === o.value;
                return (
                  <button key={o.value ?? "off"} type="button" role="radio" aria-checked={on} disabled={o.disabled || busy === "card"}
                    title={o.disabled ? "Önce bu ortamın anahtarlarını ekleyin." : undefined}
                    onClick={() => { if (on) return; if (o.value === "production") setConfirmLive(true); else void setCard(o.value); }}
                    className={`h-8 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">Test ortamında gerçek para çekilmez; iyzico’nun test kartlarıyla deneme yapılır. Anahtarı olmayan ortam seçilemez.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {initial.iyzico.accounts.map((a) => <IyzicoKeysForm key={`${a.environment}:${a.updatedAt ?? "none"}`} account={a} active={activeCard === a.environment} />)}
          </div>
        </div>
      </AdminCard>

      <BankTransferCard settings={initial.bankTransfer} />

      <AdminConfirmDialog open={confirmLive} title="Canlı ödemeler açılsın mı?"
        description="Bundan sonra kartla verilen siparişlerde müşterinin kartından gerçek çekim yapılır. Canlı anahtarları “Bağlantıyı test et” ile doğruladığınızdan emin olun."
        confirmLabel="Evet, canlıya al" busyLabel="Açılıyor…" tone="primary" busy={busy === "card"}
        onConfirm={async () => { await setCard("production"); setConfirmLive(false); }} onCancel={() => setConfirmLive(false)} />
    </div>
  );
}

function IyzicoKeysForm({ account, active }: { account: IyzicoAccountView; active: boolean }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [form, setForm] = useState({ apiKey: "", secretKey: "" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const env = account.environment;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      await paymentsApi.saveIyzicoKeys({ environment: env, apiKey: form.apiKey || undefined, secretKey: form.secretKey || undefined, expectedUpdatedAt: account.updatedAt });
      notify.success(account.configured ? "iyzico anahtarları güncellendi" : "iyzico anahtarları eklendi", { description: "Anahtarları denemek için “Bağlantıyı test et”e basın." });
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "iyzico anahtarları kaydedilemedi." });
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await paymentsApi.testIyzico(env);
      notify.success("iyzico anahtarları çalışıyor", { description: `${IYZICO_ENV_LABEL[env]} · ${(r.data.latencyMs / 1000).toFixed(1)} sn` });
    } catch (err) {
      notify.error(err, { fallback: "iyzico bağlantısı test edilemedi." });
    } finally {
      setTesting(false);
    }
  };

  const id = (k: string) => `iyz-${env}-${k}`;
  return (
    <form onSubmit={save} noValidate className={`rounded-xl border p-4 ${active ? "border-[#7367f0]/40 bg-indigo-50/30" : "border-slate-200"}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`grid size-10 flex-none place-items-center rounded-xl ${env === "production" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
            {env === "production" ? <ShieldCheck className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{IYZICO_ENV_LABEL[env]}</p>
            <p className="text-xs text-slate-500">
              {account.configured ? `Anahtarlar kayıtlı · API ${account.apiKeyHint ?? "…"}${account.updatedAt ? ` · ${dt.format(new Date(account.updatedAt))}` : ""}` : "Anahtar girilmedi"}
            </p>
          </div>
        </div>
        {active ? <AdminBadge tone="purple">Kullanımda</AdminBadge> : account.configured ? <AdminBadge tone="green">Hazır</AdminBadge> : null}
      </div>
      <div className="space-y-3">
        <Field id={id("api")} label="API anahtarı" required={!account.configured} error={errors.get("apiKey")}>
          <input id={id("api")} type="password" autoComplete="off" spellCheck={false} className={`${inputCls} h-10 font-mono`} value={form.apiKey}
            placeholder={account.configured ? "Değiştirmeyecekseniz boş bırakın" : env === "sandbox" ? "sandbox-…" : "API key"}
            onChange={(e) => { setForm((f) => ({ ...f, apiKey: e.target.value })); errors.clear("apiKey"); }} aria-invalid={errors.has("apiKey")} />
        </Field>
        <Field id={id("secret")} label="Güvenlik anahtarı (secret key)" required={!account.configured} error={errors.get("secretKey")}
          hint="Şifrelenerek saklanır ve bir daha gösterilmez.">
          <input id={id("secret")} type="password" autoComplete="new-password" spellCheck={false} className={`${inputCls} h-10 font-mono`} value={form.secretKey}
            placeholder={account.configured ? "••••••••••••" : "Secret key"}
            onChange={(e) => { setForm((f) => ({ ...f, secretKey: e.target.value })); errors.clear("secretKey"); }} aria-invalid={errors.has("secretKey")} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {account.configured && (
          <button type="button" onClick={test} disabled={testing} className={btn}>
            <ShieldCheck className="h-4 w-4" /> {testing ? "Deneniyor…" : "Bağlantıyı test et"}
          </button>
        )}
        <button type="submit" disabled={saving} className={primary}>
          <KeyRound className="h-4 w-4" />
          {saving ? (account.configured ? "Güncelleniyor…" : "Ekleniyor…") : account.configured ? "Güncelle" : "Anahtarları ekle"}
        </button>
      </div>
    </form>
  );
}

const emptyAccount = { bankName: "", accountHolder: "", iban: "", instructions: "", isActive: true };

function BankTransferCard({ settings }: { settings: PaymentSettingsView["bankTransfer"] }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [toggling, setToggling] = useState(false);
  const [editing, setEditing] = useState<BankAccountView | "new" | null>(null);
  const [form, setForm] = useState(emptyAccount);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<BankAccountView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activeCount = settings.accounts.filter((a) => a.isActive).length;

  const toggle = async (active: boolean) => {
    setToggling(true);
    try {
      await paymentsApi.setBankTransfer(active);
      notify.success(active ? "Havale / EFT açıldı" : "Havale / EFT kapatıldı");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Havale / EFT ayarı değiştirilemedi." });
    } finally {
      setToggling(false);
    }
  };

  const open = (a: BankAccountView | "new") => {
    errors.clear();
    setForm(a === "new" ? emptyAccount : { bankName: a.bankName, accountHolder: a.accountHolder, iban: formatIban(a.iban), instructions: a.instructions ?? "", isActive: a.isActive });
    setEditing(a);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !editing) return;
    setSaving(true);
    errors.clear();
    const input = { ...form, instructions: form.instructions || null };
    try {
      if (editing === "new") await paymentsApi.createBankAccount(input);
      else await paymentsApi.updateBankAccount(editing.id, input);
      notify.success(editing === "new" ? "Banka hesabı eklendi" : "Banka hesabı güncellendi");
      setEditing(null);
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Banka hesabı kaydedilemedi." });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setDeleting(true);
    try {
      await paymentsApi.deleteBankAccount(removing.id);
      notify.success("Banka hesabı silindi");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Banka hesabı silinemedi." });
    } finally {
      setDeleting(false);
      setRemoving(null);
    }
  };

  const set = (k: "bankName" | "accountHolder" | "iban" | "instructions") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    errors.clear(k);
  };

  return (
    <AdminCard className="max-w-5xl">
      <AdminCardTitle title="Havale / EFT" subtitle="Sipariş, ödeme banka hesabınızda görülüp “Havaleyi onayla” ile eşleştirilince hazırlanır."
        actions={<Switch checked={settings.active} onChange={toggle} disabled={toggling || (!settings.active && activeCount === 0)} label={settings.active ? "Açık" : "Kapalı"} />} />
      <div className="px-5 py-5">
        {!settings.active && activeCount === 0 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">Havale / EFT’yi açmak için önce en az bir aktif banka hesabı ekleyin.</p>
        )}
        {settings.accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
            <Landmark className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-600">Henüz banka hesabı yok.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {settings.accounts.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    {a.bankName}
                    {!a.isActive && <AdminBadge>Pasif</AdminBadge>}
                    {a.inUse && <AdminBadge tone="blue">Siparişlerde kullanıldı</AdminBadge>}
                  </p>
                  <p className="text-xs text-slate-500">{a.accountHolder}</p>
                  <p className="mt-1 break-all font-mono text-sm text-slate-700">{formatIban(a.iban)}</p>
                </div>
                <div className="flex flex-none gap-1">
                  <button type="button" onClick={() => open(a)} className={btn} aria-label={`${a.bankName} hesabını düzenle`}><Pencil className="h-4 w-4" /> Düzenle</button>
                  {!a.inUse && (
                    <button type="button" onClick={() => setRemoving(a)} aria-label={`${a.bankName} hesabını sil`}
                      className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Aktif hesaplar ödeme sayfasında ve sipariş sonrası ekranda müşteriye gösterilir.</p>
          <button type="button" onClick={() => open("new")} className={btn}><Plus className="h-4 w-4" /> Hesap ekle</button>
        </div>
      </div>

      <AdminDrawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Banka hesabı ekle" : "Banka hesabını güncelle"}
        subtitle="Müşteri havaleyi bu hesaba yapar."
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={btn}>Vazgeç</button>
            <button type="submit" form="bank-account-form" disabled={saving} className={primary}>
              <CreditCard className="h-4 w-4" />
              {saving ? (editing === "new" ? "Ekleniyor…" : "Güncelleniyor…") : editing === "new" ? "Hesabı ekle" : "Güncelle"}
            </button>
          </div>
        }>
        <form id="bank-account-form" onSubmit={save} noValidate className="space-y-4">
          <Field id="ba-bank" label="Banka" required error={errors.get("bankName")}>
            <input id="ba-bank" className={`${inputCls} h-10`} value={form.bankName} maxLength={80} placeholder="Ör. Ziraat Bankası" onChange={set("bankName")} aria-invalid={errors.has("bankName")} />
          </Field>
          <Field id="ba-holder" label="Hesap sahibi" required error={errors.get("accountHolder")} hint="Bankada görünen ünvan veya ad soyad.">
            <input id="ba-holder" className={`${inputCls} h-10`} value={form.accountHolder} maxLength={120} onChange={set("accountHolder")} aria-invalid={errors.has("accountHolder")} />
          </Field>
          <Field id="ba-iban" label="IBAN" required error={errors.get("iban")}
            hint={editing !== "new" && editing?.inUse ? "Siparişlerde kullanılan hesabın IBAN'ı değiştirilemez; yeni hesap ekleyin." : undefined}>
            <input id="ba-iban" className={`${inputCls} h-10 font-mono uppercase`} value={form.iban} maxLength={42} placeholder="TR00 0000 0000 0000 0000 0000 00"
              readOnly={editing !== "new" && !!editing?.inUse} onChange={set("iban")} aria-invalid={errors.has("iban")} spellCheck={false} autoComplete="off" />
          </Field>
          <Field id="ba-note" label="Müşteriye not" error={errors.get("instructions")} hint="Ör. “Açıklamaya sipariş numaranızı yazın.”">
            <textarea id="ba-note" rows={3} maxLength={300} className={`${inputCls} min-h-20 py-2`} value={form.instructions} onChange={set("instructions")} />
          </Field>
          <Switch checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} label="Aktif — müşteriye gösterilir" />
        </form>
      </AdminDrawer>

      <AdminConfirmDialog open={removing !== null} title="Banka hesabı silinsin mi?"
        description={removing ? `${removing.bankName} · ${formatIban(removing.iban)} kalıcı olarak silinecek.` : ""}
        confirmLabel="Evet, sil" busyLabel="Siliniyor…" busy={deleting} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </AdminCard>
  );
}

