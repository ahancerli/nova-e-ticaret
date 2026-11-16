"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, PlugZap, ShieldCheck, TriangleAlert } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { AdminCard, AdminCardTitle } from "@/components/admin/ui";
import type { ChannelOverview } from "@/modules/social-ai";
import { CHANNELS, KVKK_SENTENCE, MESSAGE_STATUS_LABELS } from "@/modules/social-ai/domain/social-ai";
import { socialAiApi } from "./api";
import { ChannelMark, Switch, btn, danger, dateTimeFmt, primary } from "./ui";

const dayFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

/** Status screen of a connected channel: who is connected, is the bot answering, today's traffic, what went wrong. */
export function ChannelStatus({ overview, justConnected, onChanged }: { overview: ChannelOverview; justConnected: boolean; onChanged: () => void }) {
  const { channel, stats, ai } = overview;
  const c = overview.connection!;
  const label = CHANNELS[channel].label;
  const [busy, setBusy] = useState<"toggle" | "test" | "welcome" | "disconnect" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [welcome, setWelcome] = useState(c.welcomeMessage ?? "");
  const [copied, setCopied] = useState(false);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string>) => {
    setBusy(kind);
    try {
      notify.success(await fn());
      onChanged();
    } catch (err) {
      notify.error(err);
      onChanged();
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };
  const copyKvkk = async () => {
    try { await navigator.clipboard.writeText(KVKK_SENTENCE); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { notify.warning("Kopyalanamadı; metni elle seçin."); }
  };

  const live = c.isEnabled && c.status === "connected" && ai.ready;
  const state = c.status === "error" ? { text: "Bağlantıda sorun var", cls: "bg-red-50 text-red-700" } : !ai.ready ? { text: "AI entegrasyonu bekleniyor", cls: "bg-amber-50 text-amber-700" }
    : c.isEnabled ? { text: "Bot cevaplıyor", cls: "bg-emerald-50 text-emerald-700" } : { text: "Bot kapalı", cls: "bg-slate-100 text-slate-600" };

  return (
    <div className="space-y-4">
      {justConnected ? (
        <div role="status" className="rounded-2xl bg-emerald-50 px-5 py-4 text-sm text-emerald-900 ring-1 ring-emerald-200">
          <p className="font-semibold">{label} hazır.</p>
          <p className="mt-1">{channel === "whatsapp" ? "Başka bir telefondan bu numaraya WhatsApp mesajı atıp deneyin." : "Başka bir Instagram hesabından bu hesaba DM atıp deneyin."} Cevap birkaç saniye içinde gelir; konuşmayı Konuşmalar ekranında görebilirsiniz.</p>
        </div>
      ) : null}

      {c.status === "error" ? (
        <div role="alert" className="flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" />
          <span>{c.lastError ?? "Meta bağlantıyı kabul etmiyor."} “Bağlantıyı test et” ile yeniden deneyin; düzelmezse bağlantıyı kesip kurulumu baştan yapın.</span>
        </div>
      ) : null}

      <AdminCard>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative">
              <ChannelMark channel={channel} size={44} />
              {live ? <span aria-hidden className="absolute -right-1 -top-1 size-3 rounded-full bg-emerald-500 ring-2 ring-white" /> : null}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-900">{c.displayName ?? c.externalId}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className={`rounded-full px-2 py-0.5 font-medium ${state.cls}`}>{state.text}</span>
                <span>{dayFmt.format(new Date(c.connectedAt))} tarihinde{c.connectedByName ? ` ${c.connectedByName} tarafından` : ""} bağlandı</span>
              </p>
            </div>
          </div>
          <Switch label={c.isEnabled ? "Bot açık" : "Bot kapalı"} checked={c.isEnabled} disabled={!!busy}
            onChange={(isEnabled) => void run("toggle", async () => { await socialAiApi.updateChannel(channel, { isEnabled, expectedUpdatedAt: c.updatedAt }); return isEnabled ? `${label} botu açıldı` : `${label} botu kapatıldı`; })} />
        </div>
        <dl className="grid border-t border-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-slate-200">
          {[
            { k: "Bugün gelen mesaj", v: stats.inboundToday, href: null },
            { k: "Bugün gönderilen cevap", v: stats.repliesToday, href: null },
            { k: "Personel bekleyen konuşma", v: stats.handoffsOpen, href: `/admin/social-ai/konusmalar?durum=handoff&kanal=${channel}` },
          ].map((s) => (
            <div key={s.k} className="px-5 py-4">
              <dt className="text-xs font-medium text-slate-500">{s.k}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{s.v}{s.href && s.v > 0 ? <Link href={s.href} className="ml-3 text-sm font-medium text-[#7367f0] hover:underline">Konuşmaları aç</Link> : null}</dd>
            </div>
          ))}
        </dl>
      </AdminCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCard>
          <AdminCardTitle title="Karşılama mesajı" subtitle={`Yalnız ${label} için. Boş bırakılırsa Bot ayarları'ndaki ortak karşılama kullanılır.`} />
          <form className="space-y-3 px-5 py-5" onSubmit={(e) => { e.preventDefault(); void run("welcome", async () => { await socialAiApi.updateChannel(channel, { isEnabled: c.isEnabled, welcomeMessage: welcome, expectedUpdatedAt: c.updatedAt }); return "Karşılama mesajı güncellendi"; }); }}>
            <Field id="channel-welcome" label="Müşterinin ilk mesajına verilen cevabın başı" hint={<Counter value={welcome} max={500} />}>
              <textarea id="channel-welcome" rows={3} maxLength={500} className={`${inputCls} py-2`} value={welcome} onChange={(e) => setWelcome(e.target.value)} placeholder="Merhaba, hoş geldiniz! Size nasıl yardımcı olabilirim?" />
            </Field>
            <button type="submit" disabled={!!busy || welcome === (c.welcomeMessage ?? "")} className={primary}>{busy === "welcome" ? "Güncelleniyor…" : "Güncelle"}</button>
          </form>
        </AdminCard>

        <AdminCard>
          <AdminCardTitle title="Gönderilemeyen son mesajlar" subtitle="Pencere dışına düşen ya da Meta'nın reddettiği cevaplar." />
          {stats.failures.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-500">Gönderilemeyen mesaj yok.</p> : (
            <ul className="divide-y divide-slate-100">
              {stats.failures.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{MESSAGE_STATUS_LABELS[f.status]}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{f.error ?? "Ayrıntı yok."}</p>
                  </div>
                  <div className="flex-none text-right text-xs text-slate-500">
                    <p>{dateTimeFmt.format(new Date(f.at))}</p>
                    <Link href={`/admin/social-ai/konusmalar?konusma=${f.conversationId}`} className="font-medium text-[#7367f0] hover:underline">Konuşmayı aç</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      <AdminCard>
        <AdminCardTitle title="Bağlantı ve veri saklama" />
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-2">
          <div className="space-y-3 text-sm text-slate-600">
            <p>Kanal, siz kapatana kadar bağlı kalır. {c.tokenExpiresAt ? `Erişim anahtarı ${dayFmt.format(new Date(c.tokenExpiresAt))} tarihine kadar geçerli; süresi dolmadan otomatik yenilenir.` : "Erişim anahtarının süresi dolmaz."}{c.connectedVia === "manual" ? " (Elle girilen bilgilerle bağlandı.)" : ""}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btn} disabled={!!busy} onClick={() => void run("test", async () => { await socialAiApi.test(channel); return "Bağlantı çalışıyor, mesaj bildirimleri açık"; })}><ShieldCheck className="h-4 w-4" /> {busy === "test" ? "Test ediliyor…" : "Bağlantıyı test et"}</button>
              <button type="button" className={danger} disabled={!!busy} onClick={() => setConfirm(true)}><PlugZap className="h-4 w-4" /> Bağlantıyı kes</button>
            </div>
          </div>
          <div className="space-y-2 text-sm text-slate-600">
            <p>Konuşmalar, mesajlar ve botun araç kayıtları <strong className="font-semibold text-slate-800">{overview.retentionDays} gün</strong> saklanır; daha eskileri her gün kalıcı olarak silinir. KVKK aydınlatma metninize şu cümleyi eklemenizi öneririz:</p>
            <blockquote className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">{KVKK_SENTENCE}</blockquote>
            <button type="button" className={btn} onClick={() => void copyKvkk()}>{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? "Kopyalandı" : "Cümleyi kopyala"}</button>
          </div>
        </div>
      </AdminCard>

      <AdminConfirmDialog open={confirm} title={`${label} bağlantısı kesilsin mi?`} busy={busy === "disconnect"} confirmLabel="Bağlantıyı kes"
        description="Bot bu kanaldaki mesajlara cevap vermeyi bırakır ve erişim anahtarı silinir. Geçmiş konuşmalar saklama süresi dolana kadar görünür. Yeniden bağlamak için kurulumu baştan yaparsınız."
        onCancel={() => setConfirm(false)} onConfirm={() => void run("disconnect", async () => { await socialAiApi.disconnect(channel); return `${label} bağlantısı kesildi`; })} />
    </div>
  );
}
