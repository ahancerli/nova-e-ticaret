"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw, SendHorizontal } from "lucide-react";
import { errorMessage } from "@/lib/api-client";
import type { BotSettings, Channel, ReferralMapView, ToolTrace } from "@/modules/social-ai";
import { CHANNELS, CHANNEL_KEYS } from "@/modules/social-ai/domain/social-ai";
import { socialAiApi } from "./api";
import { Bubble, ChannelMark, ToolRow } from "./ui";

type Entry =
  | { kind: "message"; role: "user" | "assistant"; text: string }
  | { kind: "tools"; tools: ToolTrace[] }
  | { kind: "note"; text: string; tone: "amber" | "red" };

const STARTERS = ["Merhaba, kargo kaç günde gelir?", "İade koşullarınız nedir?", "Bot musun?"];

/**
 * Test chat of the bot settings: talks to the real bot with the form's current (unsaved) values. Nothing is stored and
 * nothing is sent to a customer.
 */
export function TestChat({ draft, disabled, maps }: { draft: BotSettings; disabled: boolean; maps: ReferralMapView[] }) {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [mapId, setMapId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [entries, busy]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy || disabled) return;
    const next: Entry[] = [...entries, { kind: "message", role: "user", text: message }];
    setEntries(next);
    setText("");
    setBusy(true);
    try {
      const history = next.flatMap((e) => (e.kind === "message" ? [{ role: e.role, text: e.text }] : []));
      const { data } = await socialAiApi.preview({ channel, settings: draft, messages: history, referralMapId: mapId || null });
      setEntries((cur) => [
        ...cur,
        ...(data.tools.length ? [{ kind: "tools" as const, tools: data.tools }] : []),
        ...data.messages.map((m) => ({ kind: "message" as const, role: "assistant" as const, text: m })),
        ...(data.handoffReason ? [{ kind: "note" as const, tone: "amber" as const, text: `Bot konuşmayı personele devrederdi: ${data.handoffReason}` }] : []),
      ]);
    } catch (err) {
      setEntries((cur) => [...cur, { kind: "note", tone: "red", text: errorMessage(err, "Cevap alınamadı. Tekrar deneyin.") }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Test sohbeti" className="flex h-[min(680px,calc(100vh-7rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <ChannelMark channel={channel} size={30} />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Botu deneyin</h2>
            <p className="text-xs text-slate-500">Soldaki ayarları güncellemeden önce cevapları görün.</p>
          </div>
        </div>
        <button type="button" onClick={() => setEntries([])} disabled={!entries.length || busy} aria-label="Sohbeti temizle" className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"><RotateCcw className="h-4 w-4" /></button>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs">
        <div role="radiogroup" aria-label="Kanal" className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
          {CHANNEL_KEYS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => setChannel(c)} className={`rounded-md px-2.5 py-1 font-medium ${channel === c ? "bg-[#7367f0] text-white" : "text-slate-600 hover:bg-slate-50"}`}>{CHANNELS[c].label}</button>
          ))}
        </div>
        {maps.length ? (
          <label className="flex min-w-0 items-center gap-1.5 text-slate-600">
            <span className="flex-none">Geldiği yer</span>
            <select value={mapId} onChange={(e) => { setMapId(e.target.value); setEntries([]); }} className="h-7 min-w-0 max-w-44 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700">
              <option value="">Doğrudan yazdı</option>
              {maps.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <div ref={scroller} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto bg-[#f7f7fb] px-4 py-4">
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-64 text-sm text-slate-500">{disabled ? "Test için önce AI entegrasyonu gerekli." : "Müşteri gibi bir şey yazın. Bot gerçek kataloğunuz ve içeriklerinizle cevap verir; hiçbir şey kaydedilmez."}</p>
            {disabled ? null : (
              <div className="flex flex-wrap justify-center gap-1.5">
                {STARTERS.map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-[#7367f0]/50">{s}</button>)}
              </div>
            )}
          </div>
        ) : entries.map((e, i) => (
          e.kind === "message" ? <Bubble key={i} sender={e.role === "user" ? "customer" : "bot"} body={e.text} />
            : e.kind === "tools" ? <div key={i} className="space-y-1.5">{e.tools.map((t, k) => <ToolRow key={k} {...t} />)}</div>
              : <p key={i} role={e.tone === "red" ? "alert" : "status"} className={`mx-auto w-fit max-w-full rounded-lg px-3 py-1.5 text-center text-xs ring-1 ${e.tone === "red" ? "bg-red-50 text-red-800 ring-red-100" : "bg-amber-50 text-amber-900 ring-amber-200"}`}>{e.text}</p>
        ))}
        {busy ? <p className="flex w-fit items-center gap-1 rounded-2xl rounded-br-md bg-[#efedfd] px-3.5 py-3 ml-auto" aria-label="Bot yazıyor">{[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-pulse rounded-full bg-[#7367f0]" style={{ animationDelay: `${d * 160}ms` }} />)}</p> : null}
      </div>

      <form className="flex items-end gap-2 border-t border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <label htmlFor="test-chat-input" className="sr-only">Müşteri mesajı</label>
        <textarea id="test-chat-input" rows={1} value={text} disabled={disabled} maxLength={1000} placeholder="Müşteri gibi yazın…"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
          className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#7367f0] disabled:bg-slate-50" />
        <button type="submit" disabled={busy || disabled || !text.trim()} aria-label="Gönder" className="inline-flex size-10 flex-none items-center justify-center rounded-xl bg-[#7367f0] text-white hover:bg-[#6559df] disabled:opacity-50"><SendHorizontal className="h-4 w-4" /></button>
      </form>
    </section>
  );
}
