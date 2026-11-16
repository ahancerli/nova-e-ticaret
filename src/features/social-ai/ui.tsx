"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { Bot, Camera, Headset, Info, MessageCircle, Wrench } from "lucide-react";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import type { AiReadiness, Channel, MessageSender, MessageStatus } from "@/modules/social-ai";
import { CHANNELS, MESSAGE_STATUS_LABELS } from "@/modules/social-ai/domain/social-ai";
import { TOOL_LABELS, type ToolName } from "@/modules/social-ai/domain/prompt";

export const AI_PAGE = "/admin/entegrasyonlar/ai";
export const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
export const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";
export const danger = "inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60";
export const timeFmt = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
export const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** The channel's own colour is used for this mark only; everything else stays in the panel's palette. */
const MARK: Record<Channel, { bg: string; Icon: typeof Camera }> = {
  whatsapp: { bg: "#1faa59", Icon: MessageCircle },
  instagram: { bg: "#d6336c", Icon: Camera },
};

export function ChannelMark({ channel, size = 36 }: { channel: Channel; size?: number }) {
  const { bg, Icon } = MARK[channel];
  return (
    <span role="img" aria-label={CHANNELS[channel].label} className="inline-flex flex-none items-center justify-center rounded-xl text-white" style={{ width: size, height: size, background: bg }}>
      <Icon aria-hidden style={{ width: size * 0.56, height: size * 0.56 }} strokeWidth={2.2} />
    </span>
  );
}

/**
 * Shown on every Social AI Marketing page while the shop has no AI integration: the module answers with the shop's own
 * AI provider, so nothing here works without its key. The page stays open behind the dialog.
 */
export function AiRequiredDialog({ ai }: { ai: AiReadiness }) {
  const router = useRouter();
  const [open, setOpen] = useState(!ai.ready);
  return (
    <AdminConfirmDialog open={open} tone="primary" title="Önce AI entegrasyonu gerekli"
      description="Social AI Marketing, mesajları mağazanızın bağladığı yapay zekâ modeliyle cevaplar. Henüz bir API anahtarı girilmemiş; Entegrasyonlar › AI entegrasyonları sayfasından sağlayıcınızı seçip anahtarınızı girin, sonra buraya dönün."
      confirmLabel="AI entegrasyonlarına git" onConfirm={() => router.push(AI_PAGE)} onCancel={() => setOpen(false)} />
  );
}

export function AiRequiredNote({ ai }: { ai: AiReadiness }) {
  if (ai.ready) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <span>AI entegrasyonu yapılmadığı için bu modül kullanılamıyor. API anahtarınızı girdikten sonra kurulum açılır.</span>
      <a href={AI_PAGE} className="font-semibold underline underline-offset-2">AI entegrasyonlarına git</a>
    </div>
  );
}

const SENDER: Record<MessageSender, { side: string; bubble: string; meta: string }> = {
  customer: { side: "justify-start", bubble: "rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200", meta: "text-slate-400" },
  bot: { side: "justify-end", bubble: "rounded-br-md bg-[#efedfd] text-slate-800", meta: "text-[#7367f0]" },
  staff: { side: "justify-end", bubble: "rounded-br-md bg-[#7367f0] text-white", meta: "text-slate-400" },
};

/** One message of a thread. Customer on the left; the bot (tinted) and staff (solid) on the right. */
export function Bubble({ sender, body, at, status, error, authorName }: { sender: MessageSender; body: string; at?: string | null; status?: MessageStatus; error?: string | null; authorName?: string | null }) {
  const s = SENDER[sender];
  const failed = status === "failed" || status === "blocked";
  return (
    <div className={`flex ${s.side}`}>
      <div className="max-w-[82%]">
        <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${s.bubble} ${failed ? "opacity-60" : ""}`}>{body}</p>
        <p className={`mt-1 flex items-center gap-1 text-[11px] ${sender === "customer" ? "" : "justify-end"} ${failed ? "text-red-600" : s.meta}`}>
          {sender === "bot" ? <Bot className="h-3 w-3" aria-hidden /> : sender === "staff" ? <Headset className="h-3 w-3" aria-hidden /> : null}
          <span>{sender === "bot" ? "Bot" : sender === "staff" ? authorName ?? "Personel" : "Müşteri"}</span>
          {at ? <span>{timeFmt.format(new Date(at))}</span> : null}
          {status && status !== "sent" && status !== "received" ? <span>{MESSAGE_STATUS_LABELS[status]}{error ? `: ${error}` : ""}</span> : null}
        </p>
      </div>
    </div>
  );
}

const summarise = (input: Record<string, unknown>) => {
  const v = input.query ?? input.product_id ?? input.order_number ?? input.reason ?? (Array.isArray(input.product_ids) ? input.product_ids.join(", ") : null);
  return typeof v === "string" && v ? v : null;
};

/** What the bot looked up before answering — a quiet row between bubbles, expandable to the raw input / result. */
export function ToolRow({ name, input, outputPreview, ok }: { name: string; input: Record<string, unknown>; outputPreview: string; ok: boolean }) {
  const label = TOOL_LABELS[name as ToolName] ?? name;
  const hint = summarise(input);
  return (
    <details className="group mx-auto w-fit max-w-full text-xs text-slate-500">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 hover:bg-slate-200/70 [&::-webkit-details-marker]:hidden">
        <Wrench className={`h-3 w-3 ${ok ? "text-slate-400" : "text-red-500"}`} aria-hidden />
        <span className="font-medium text-slate-600">{label}</span>
        {hint ? <span className="max-w-56 truncate">{hint}</span> : null}
        {ok ? null : <span className="text-red-600">sonuç alınamadı</span>}
      </summary>
      <div className="mt-1.5 space-y-1 rounded-lg bg-slate-50 p-2.5 ring-1 ring-slate-200">
        <p className="break-all font-mono text-[11px] text-slate-600">{JSON.stringify(input)}</p>
        {outputPreview ? <p className="break-words font-mono text-[11px] text-slate-500">{outputPreview}</p> : null}
      </div>
    </details>
  );
}

export const META_APPS_URL = "https://developers.facebook.com/apps";

/**
 * Wraps one form field and adds a "Nereden alınır?" button on its label line; the button opens the steps to find that
 * value in Meta's developer panel. `steps` is a real sequence, so it is numbered.
 */
export function HelpField({ name, steps, note, children }: { name: string; steps: ReactNode[]; note?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="relative">
      {children}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} aria-label={`${name}: nereden alınır?`}
        className="absolute right-0 top-0 inline-flex items-center gap-1 rounded text-xs font-medium text-[#7367f0] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7367f0]">
        <Info className="h-3.5 w-3.5" aria-hidden /><span className="hidden sm:inline">Nereden alınır?</span>
      </button>
      {open ? (
        <div id={id} className="mt-2 rounded-lg bg-[#f6f5fe] px-3 py-2.5 text-xs leading-relaxed text-slate-700 ring-1 ring-[#7367f0]/20">
          <ol className="list-decimal space-y-1 pl-4">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {note ? <p className="mt-2 text-slate-600">{note}</p> : null}
          <a href={META_APPS_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium text-[#7367f0] underline underline-offset-2">Meta for Developers&apos;ı aç</a>
        </div>
      ) : null}
    </div>
  );
}

/** Small on / off switch with a real checkbox underneath. */
export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className={`inline-flex items-center gap-2.5 text-sm font-medium text-slate-700 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <span className="relative inline-flex">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition-colors peer-checked:bg-[#7367f0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#7367f0]/40 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
      {label}
    </label>
  );
}
