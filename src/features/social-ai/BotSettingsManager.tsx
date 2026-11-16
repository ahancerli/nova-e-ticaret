"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Counter, Field, inputCls } from "@/components/admin/form";
import type { PickOption } from "@/components/admin/OrderedPicker";
import { AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import type { AiReadiness, BotSettings, BotSettingsView, ReferralMapView, Tone } from "@/modules/social-ai";
import { MAX_EXAMPLES, TONES, TONE_KEYS } from "@/modules/social-ai/domain/social-ai";
import { socialAiApi } from "./api";
import { ReferralMaps } from "./ReferralMaps";
import { TestChat } from "./TestChat";
import { AiRequiredDialog, AiRequiredNote, Switch, btn, primary } from "./ui";

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const draftOf = (s: BotSettingsView): BotSettings => ({
  tone: s.tone, toneNote: s.toneNote, welcomeMessage: s.welcomeMessage, rulesText: s.rulesText, bansText: s.bansText, examples: s.examples, hoursEnabled: s.hoursEnabled, hours: s.hours,
  offHoursMessage: s.offHoursMessage, handoffRules: s.handoffRules, conversationLimit: s.conversationLimit, dailyLimit: s.dailyLimit,
});

/**
 * Social AI Marketing › Bot ayarları: how the bot talks and what it must know, shared by both channels. The test chat
 * on the right always uses what is in the form right now, so a change can be tried before it is saved.
 */
export function BotSettingsManager({ initial, maps, products, ai }: { initial: BotSettingsView; maps: ReferralMapView[]; products: PickOption[]; ai: AiReadiness }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [form, setForm] = useState<BotSettings>(() => draftOf(initial));
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(draftOf(initial)), [form, initial]);
  const set = <K extends keyof BotSettings>(k: K, v: BotSettings[K]) => { setForm((f) => ({ ...f, [k]: v })); errors.clear(k); };
  const area = (k: "toneNote" | "welcomeMessage" | "rulesText" | "bansText" | "handoffRules" | "offHoursMessage") => ({
    value: form[k], onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => set(k, e.target.value), "aria-invalid": errors.has(k), className: `${inputCls} py-2`,
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await socialAiApi.saveSettings({ ...form, expectedUpdatedAt: initial.updatedAt });
      notify.success("Bot ayarları güncellendi");
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Bot ayarları" subtitle="WhatsApp ve Instagram için ortak. Hiçbir şeye dokunmasanız da bot, kataloğunuz ve site içeriklerinizle makul cevaplar verir; burası onu mağazanıza benzetmek için." />
      <AiRequiredNote ai={ai} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <form onSubmit={save} noValidate className="space-y-4">
          <AdminCard>
            <AdminCardTitle title="Marka sesi" subtitle="Bot müşterilerinizle nasıl konuşsun?" />
            <div className="space-y-4 px-5 py-5">
              <div role="radiogroup" aria-label="Marka sesi" className="grid gap-2 sm:grid-cols-3">
                {TONE_KEYS.map((k: Tone) => (
                  <label key={k} className={`cursor-pointer rounded-xl border px-3.5 py-3 text-sm ${form.tone === k ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200 hover:border-slate-300"}`}>
                    <input type="radio" name="tone" className="sr-only" checked={form.tone === k} onChange={() => set("tone", k)} />
                    <span className="block font-semibold text-slate-900">{TONES[k].label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{TONES[k].hint}</span>
                  </label>
                ))}
              </div>
              <Field id="bot-tone-note" label="Eklemek istedikleriniz" error={errors.get("toneNote")} hint={<Counter value={form.toneNote} max={1000} />}>
                <textarea id="bot-tone-note" rows={2} maxLength={1000} placeholder="Müşteriye adıyla hitap et. Cümle sonunda emoji kullanma." {...area("toneNote")} />
              </Field>
              <Field id="bot-welcome" label="Karşılama mesajı" error={errors.get("welcomeMessage")} hint="Müşterinin ilk mesajına verilen cevabın başında kullanılır. Kanal sayfasından kanala özel yazabilirsiniz.">
                <textarea id="bot-welcome" rows={2} maxLength={500} placeholder="Merhaba, hoş geldiniz!" {...area("welcomeMessage")} />
              </Field>
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Botun bilmesi gerekenler" subtitle="Bot fiyat, stok ve teslim bilgisini katalogdan, genel soruların cevabını site sayfalarınızdan okur. Orada yazmayanları buraya ekleyin." />
            <div className="space-y-4 px-5 py-5">
              <Field id="bot-rules" label="Mağaza kuralları" error={errors.get("rulesText")} hint={<Counter value={form.rulesText} max={4000} />}>
                <textarea id="bot-rules" rows={5} maxLength={4000} placeholder={"Kargo: 500 TL üzeri ücretsiz, altı 49 TL.\nİade: 14 gün içinde, ürün kullanılmamış olmalı.\nÖdeme: kredi kartı, havale, kapıda ödeme.\nKampanya: bu ay ikinci üründe %20."} {...area("rulesText")} />
              </Field>
              <Field id="bot-bans" label="Yapmaması gerekenler" error={errors.get("bansText")} hint={<Counter value={form.bansText} max={2000} />}>
                <textarea id="bot-bans" rows={3} maxLength={2000} placeholder={"Rakip markalardan bahsetme.\nPazarlık yapma, indirim sözü verme."} {...area("bansText")} />
              </Field>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">Değiştirilemeyen iki kural her zaman geçerlidir: bot, kendisine sorulduğunda yapay zekâ olduğunu söyler; fiyat, stok, kargo ve iade bilgisini uydurmaz.</p>
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Örnek cevaplar" subtitle="Beğendiğiniz üslubu gösteren birkaç soru ve cevap. Bot bunları kopyalamaz, tonu yakalar."
              actions={<button type="button" className={btn} disabled={form.examples.length >= MAX_EXAMPLES} onClick={() => set("examples", [...form.examples, { question: "", answer: "" }])}><Plus className="h-4 w-4" /> Örnek ekle</button>} />
            {form.examples.length === 0 ? <p className="px-5 py-6 text-center text-sm text-slate-500">Örnek eklemek zorunlu değil.</p> : (
              <ul className="divide-y divide-slate-100">
                {form.examples.map((ex, i) => (
                  <li key={i} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_auto]">
                    <Field id={`ex-q-${i}`} label="Müşteri sorar" error={errors.get(`examples.${i}.question`)}>
                      <textarea id={`ex-q-${i}`} rows={2} maxLength={300} className={`${inputCls} py-2`} value={ex.question} onChange={(e) => set("examples", form.examples.map((x, k) => (k === i ? { ...x, question: e.target.value } : x)))} />
                    </Field>
                    <Field id={`ex-a-${i}`} label="Bot cevaplar" error={errors.get(`examples.${i}.answer`)}>
                      <textarea id={`ex-a-${i}`} rows={2} maxLength={600} className={`${inputCls} py-2`} value={ex.answer} onChange={(e) => set("examples", form.examples.map((x, k) => (k === i ? { ...x, answer: e.target.value } : x)))} />
                    </Field>
                    <button type="button" aria-label={`${i + 1}. örneği kaldır`} onClick={() => set("examples", form.examples.filter((_, k) => k !== i))} className="mt-6 inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Canlı desteğe devir" subtitle="Bot devrettiğinde o konuşmada susar ve “Social AI konuşmaları” yetkisi olan personele bildirim gider. Konuşmalar ekranından bota geri verebilirsiniz." />
            <div className="space-y-4 px-5 py-5">
              <p className="text-sm text-slate-600">Bot şu durumlarda kendiliğinden devreder: müşteri bir insanla görüşmek isterse, şikâyet ya da çözemeyeceği bir sorun varsa, aynı soruya iki kez cevap bulamazsa.</p>
              <Field id="bot-handoff" label="Ek devir kuralları" error={errors.get("handoffRules")} hint={<Counter value={form.handoffRules} max={2000} />}>
                <textarea id="bot-handoff" rows={3} maxLength={2000} placeholder={"Toptan alım sorularını devret.\n5.000 TL üzeri siparişlerde devret."} {...area("handoffRules")} />
              </Field>
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Çalışma saatleri ve limitler" />
            <div className="space-y-5 px-5 py-5">
              <Switch label="Bot yalnız çalışma saatlerinde cevap versin" checked={form.hoursEnabled} onChange={(v) => set("hoursEnabled", v)} />
              {form.hoursEnabled ? (
                <div className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-600">Günler</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS.map((d, i) => {
                        const on = form.hours.days.includes(i + 1);
                        return <button key={d} type="button" aria-pressed={on} onClick={() => { set("hours", { ...form.hours, days: on ? form.hours.days.filter((x) => x !== i + 1) : [...form.hours.days, i + 1].sort() }); errors.clear("hours.days"); }} className={`h-9 w-12 rounded-lg text-sm font-medium ${on ? "bg-[#7367f0] text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{d}</button>;
                      })}
                    </div>
                    {errors.get("hours.days") ? <p className="mt-1 text-xs text-red-600">{errors.get("hours.days")}</p> : null}
                  </div>
                  <div className="grid max-w-xs grid-cols-2 gap-3">
                    <Field id="bot-from" label="Başlangıç" error={errors.get("hours.from")}><input id="bot-from" type="time" className={`${inputCls} h-10`} value={form.hours.from} onChange={(e) => set("hours", { ...form.hours, from: e.target.value })} /></Field>
                    <Field id="bot-to" label="Bitiş" error={errors.get("hours.to")}><input id="bot-to" type="time" className={`${inputCls} h-10`} value={form.hours.to} onChange={(e) => set("hours", { ...form.hours, to: e.target.value })} /></Field>
                  </div>
                  <Field id="bot-off" label="Saat dışında gönderilen mesaj" required error={errors.get("offHoursMessage")} hint="Türkiye saatine göre. Sessiz dönemde müşteriye bir kez gönderilir.">
                    <textarea id="bot-off" rows={2} maxLength={500} {...area("offHoursMessage")} />
                  </Field>
                </div>
              ) : null}
              <div className="grid max-w-md grid-cols-2 gap-3">
                <Field id="bot-conv-limit" label="Konuşma başına bot cevabı (24 saat)" error={errors.get("conversationLimit")} hint="Aşılınca konuşma personele devredilir.">
                  <input id="bot-conv-limit" type="number" min={1} max={500} className={`${inputCls} h-10`} value={form.conversationLimit} onChange={(e) => set("conversationLimit", Number(e.target.value) || 0)} aria-invalid={errors.has("conversationLimit")} />
                </Field>
                <Field id="bot-daily-limit" label="Günlük toplam bot cevabı" error={errors.get("dailyLimit")} hint="AI maliyetini sınırlar.">
                  <input id="bot-daily-limit" type="number" min={1} max={100000} className={`${inputCls} h-10`} value={form.dailyLimit} onChange={(e) => set("dailyLimit", Number(e.target.value) || 0)} aria-invalid={errors.has("dailyLimit")} />
                </Field>
              </div>
            </div>
          </AdminCard>

          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-5 py-3 shadow-lg shadow-slate-900/5 backdrop-blur">
            <p className="text-xs text-slate-500">{dirty ? "Güncellenmemiş değişiklikler var. Test sohbeti bu taslağı kullanıyor." : initial.updatedByName ? `Son güncelleyen: ${initial.updatedByName}` : "Varsayılan ayarlar kullanılıyor."}</p>
            <button type="submit" disabled={busy || !dirty} className={primary}>{busy ? "Güncelleniyor…" : "Güncelle"}</button>
          </div>
        </form>

        <div className="xl:sticky xl:top-20">
          <TestChat draft={form} disabled={!ai.ready} maps={maps} />
        </div>
      </div>

      <ReferralMaps maps={maps} products={products} onChanged={() => router.refresh()} />
      <AiRequiredDialog ai={ai} />
    </div>
  );
}
