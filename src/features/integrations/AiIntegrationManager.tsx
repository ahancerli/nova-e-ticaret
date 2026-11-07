"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, KeyRound, PlugZap, Sparkles, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { AI_PROVIDERS, AI_PROVIDER_KEYS, type AiIntegrationView, type AiModelCatalog, type AiModelOption, type AiProvider } from "@/modules/ai/domain/providers";
import { integrationsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const retiresText = (d: string | null) => (d ? `${dayFmt.format(new Date(`${d}T00:00:00Z`))} tarihinde kapanacak` : "kullanımdan kalkıyor");
/** Catalog default = first active row (the list comes sorted, deprecated last). */
const defaultModelOf = (models: AiModelOption[]) => models.find((m) => m.status === "active")?.id ?? models[0]?.id ?? "";

/**
 * AI entegrasyonları: exactly one provider (OpenAI, Gemini or Claude) with its model and API key.
 * The key is write-only: the panel shows its last characters and never reads it back.
 */
export function AiIntegrationManager({ initial, models }: { initial: AiIntegrationView | null; models: AiModelCatalog }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [provider, setProvider] = useState<AiProvider>(initial?.provider ?? "anthropic");
  const [model, setModel] = useState(initial?.model ?? defaultModelOf(models.anthropic));
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const def = AI_PROVIDERS[provider];
  const sameProvider = initial?.provider === provider;
  const switching = !!initial && !sameProvider;
  const options = models[provider];
  // The stored model may have left the catalog; keep it selectable so a key change does not force a model change.
  const storedUnlisted = sameProvider && !options.some((m) => m.id === initial!.model);
  const selected = options.find((m) => m.id === model);

  const pick = (p: AiProvider) => {
    setProvider(p);
    setModel(initial?.provider === p ? initial.model : defaultModelOf(models[p]));
    setApiKey("");
    errors.clear();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      const r = await integrationsApi.ai.save({ provider, model, apiKey: apiKey || undefined, expectedUpdatedAt: initial?.updatedAt ?? null });
      notify.success(initial ? "AI entegrasyonu güncellendi" : "AI entegrasyonu eklendi", { description: `${r.data.providerLabel} · ${r.data.model}` });
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "AI entegrasyonu kaydedilemedi." });
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = (await integrationsApi.ai.test()).data;
      const sec = (ms: number) => `${(ms / 1000).toFixed(1)} sn`;
      notify.success("Bağlantı çalışıyor", {
        description: `${r.provider} · ${r.displayName ?? r.model} — anahtar ve model doğrulandı (${sec(r.modelCheckMs)}), deneme yanıtı alındı (${sec(r.generationMs)})`,
      });
      if (r.deprecated) notify.warning(`${r.model} ${retiresText(r.retiresAt)}`, { description: "Listeden güncel bir model seçip güncelleyin." });
    } catch (err) {
      notify.error(err, { fallback: "Bağlantı denenemedi." });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    setRemoving(true);
    try {
      await integrationsApi.ai.remove(initial.updatedAt);
      notify.success("AI entegrasyonu kaldırıldı");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "AI entegrasyonu kaldırılamadı." });
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="AI entegrasyonları"
        subtitle="Mağazada tek bir AI sağlayıcısı kullanılır. Ürün editöründeki “AI ile ürün ekle” bu sağlayıcıyla çalışır." />

      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Mevcut durum" actions={initial ? <AdminBadge tone="green">Bağlı</AdminBadge> : <AdminBadge tone="slate">Bağlı değil</AdminBadge>} />
        {initial ? (
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-11 flex-none place-items-center rounded-xl bg-indigo-50 text-[#7367f0]"><Bot className="h-5 w-5" /></span>
              <div className="text-sm">
                <p className="font-semibold text-slate-900">{initial.providerLabel} <span className="font-normal text-slate-500">· {initial.model}</span></p>
                <p className="text-xs text-slate-500">
                  Anahtar <span className="font-mono">{initial.keyHint}</span> · son güncelleme {dt.format(new Date(initial.updatedAt))}{initial.updatedBy ? ` · ${initial.updatedBy}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={test} disabled={testing}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                <PlugZap className="h-4 w-4" /> {testing ? "Deneniyor…" : "Bağlantıyı test et"}
              </button>
              <button type="button" onClick={() => setConfirmRemove(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" /> Kaldır
              </button>
            </div>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-600">Henüz bir AI sağlayıcısı bağlanmadı. Aşağıdan birini seçip API bilgilerini girin.</p>
        )}
      </AdminCard>

      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Sağlayıcı" subtitle="Yalnız birini seçebilirsiniz; başka bir sağlayıcıyı kaydetmek mevcut bağlantının yerini alır." />
        <form onSubmit={save} className="space-y-5 px-5 py-5" noValidate>
          <div role="radiogroup" aria-label="AI sağlayıcısı" className="grid gap-3 sm:grid-cols-3">
            {AI_PROVIDER_KEYS.map((p) => {
              const on = p === provider;
              const active = initial?.provider === p;
              return (
                <button key={p} type="button" role="radio" aria-checked={on} onClick={() => pick(p)}
                  className={`relative flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition ${on ? "border-[#7367f0] bg-indigo-50/60 ring-2 ring-[#7367f0]/20" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}>
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{AI_PROVIDERS[p].label}</span>
                    {active ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Bağlı" /> : null}
                  </span>
                  <span className="text-xs text-slate-500">{AI_PROVIDERS[p].tagline}</span>
                </button>
              );
            })}
          </div>

          {switching ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-100">
              Kaydettiğinizde {initial!.providerLabel} bağlantısı kaldırılır ve yerine {def.label} kullanılır.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ai-model" label="Model" required error={errors.get("model")}
              hint={selected?.status === "deprecated" ? undefined : selected?.note ?? (storedUnlisted && model === initial!.model ? "Kayıtlı model artık listede yok; listeden yenisini seçin." : undefined)}>
              <select id="ai-model" className={`${inputCls} h-10`} value={model} aria-invalid={errors.has("model")}
                onChange={(e) => { setModel(e.target.value); errors.clear("model"); }}>
                {!options.length && !storedUnlisted ? <option value="">Bu sağlayıcı için model tanımlı değil</option> : null}
                {storedUnlisted ? <option value={initial!.model}>{initial!.model} (kayıtlı)</option> : null}
                {options.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}{m.status === "deprecated" ? " — kullanımdan kalkıyor" : ""}</option>
                ))}
              </select>
              {selected?.status === "deprecated" ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" /> {selected.label} {retiresText(selected.retiresAt)}. {selected.note}
                </p>
              ) : null}
            </Field>
            <Field id="ai-key" label="API anahtarı" required={!sameProvider} error={errors.get("apiKey")}
              hint={sameProvider ? `Kayıtlı anahtar ${initial!.keyHint}. Değiştirmeyecekseniz boş bırakın.` : "Anahtar şifrelenerek saklanır ve bir daha gösterilmez."}>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="ai-key" type="password" autoComplete="off" spellCheck={false} className={`${inputCls} h-10 pl-9 font-mono`} value={apiKey}
                  placeholder={sameProvider ? "••••••••" : def.keyPlaceholder} aria-invalid={errors.has("apiKey")}
                  onChange={(e) => { setApiKey(e.target.value); errors.clear("apiKey"); }} />
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <a href={def.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[#5b4fe0] hover:underline">
              {def.label} API anahtarı nereden alınır? <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button type="submit" disabled={saving || !model}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60">
              <Sparkles className="h-4 w-4" />
              {saving ? (initial ? "Güncelleniyor…" : "Ekleniyor…") : initial ? "Güncelle" : "Entegrasyonu ekle"}
            </button>
          </div>
        </form>
      </AdminCard>

      <AdminConfirmDialog open={confirmRemove} title="AI entegrasyonu kaldırılsın mı?"
        description={`${initial?.providerLabel ?? ""} bağlantısı ve API anahtarı silinecek. Ürün editöründeki “AI ile ürün ekle” kapanır.`}
        confirmLabel="Evet, kaldır" busyLabel="Kaldırılıyor…" busy={removing} onConfirm={remove} onCancel={() => setConfirmRemove(false)} />
    </div>
  );
}
