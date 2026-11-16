import type { Clock, Logger } from "@/core";
import type { AiChat, AiChatMessage, AiToolCall } from "@/modules/ai";
import { formatMinor } from "@/lib/money";
import { BOT_TOOLS, buildSystemPrompt, type ReferralContext } from "../domain/prompt";
import type { BotSettings, Channel } from "../domain/social-ai";
import type { ProductBrief, ProductInfo, StoreKnowledge } from "./ports";

/** Tool rounds per answer: search → detail → links is three; six leaves room for a retry. */
const MAX_ROUNDS = 6;
const MAX_LINKS = 3;
const MAX_TOOL_OUTPUT = 6000;
export const FALLBACK_REPLY = "Mesajınızı aldım, bunu kontrol edip size en kısa sürede dönüş yapacağız.";

export interface ToolTrace { name: string; input: Record<string, unknown>; outputPreview: string; ok: boolean }

export interface BotReply {
  text: string;
  /** Product link messages to send right after the text. */
  links: string[];
  /** Set when the model handed the conversation to staff. */
  handoffReason: string | null;
  tools: ToolTrace[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface BotTurnInput {
  channel: Channel;
  settings: BotSettings;
  welcomeMessage: string;
  /** Conversation so far, oldest first; the last entry is the customer's newest message. */
  history: { role: "user" | "assistant"; text: string }[];
  referral: ReferralContext | null;
  firstReply: boolean;
  /** The sender's own number on WhatsApp: proves ownership of orders placed with that phone. */
  contactPhone: string | null;
}

const money = (minor: number | null) => (minor == null ? null : formatMinor(minor));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const dateFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" });

const brief = (p: ProductBrief) => ({
  id: p.id, ad: p.name, marka: p.brand, fiyat: money(p.priceMinor), sepette_fiyat: money(p.cartPriceMinor), eski_fiyat: money(p.compareAtMinor),
  stok: p.inStock ? "stokta" : "stokta yok", kampanyalar: p.campaigns,
});

const detail = (p: ProductInfo) => ({
  ...brief(p), baglanti: p.url, kisa_aciklama: p.shortDescription, aciklama: p.description,
  varyantlar: p.variants.map((v) => ({ secenek: v.options, fiyat: money(v.priceMinor), sepette_fiyat: money(v.cartPriceMinor), stok: !v.inStock ? "stokta yok" : v.fewLeft ? "son birkaç adet" : "stokta" })),
  ozellikler: p.specs, beden_tablosu: p.sizeChart, musteri_sorulari: p.questions,
  puan: p.rating == null ? null : `${p.rating.toFixed(1)} / 5 (${p.ratingCount} değerlendirme)`,
});

/** One line per product, the way a person would paste a link. */
export const linkMessage = (p: ProductBrief) => `${p.name}${p.cartPriceMinor != null ? ` · Sepette ${formatMinor(p.cartPriceMinor)}` : p.priceMinor != null ? ` · ${formatMinor(p.priceMinor)}` : ""}\n${p.url}`;

/** E-mail / phone / order number never go into the tool log shown in the panel. */
function redact(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name !== "get_order_status") return input;
  return { order_number: input.order_number ?? null, email: input.email ? "***" : null, phone: input.phone ? "***" : null };
}

/**
 * LLM orchestrator: one bot answer = the model's tool loop over the shop's read-only knowledge. Knows no channel API
 * and writes nothing — the caller stores and sends what comes back (also used as-is by the panel preview).
 */
export class BotBrain {
  constructor(private readonly ai: AiChat, private readonly knowledge: StoreKnowledge, private readonly clock: Clock, private readonly logger: Logger) {}

  async reply(input: BotTurnInput): Promise<BotReply> {
    const store = await this.knowledge.store();
    const system = buildSystemPrompt({
      storeName: store.name, siteUrl: store.siteUrl, channel: input.channel, settings: input.settings, referral: input.referral, firstReply: input.firstReply,
      welcomeMessage: input.welcomeMessage, nowText: dateFmt.format(this.clock.now()),
    });
    const messages: AiChatMessage[] = input.history.map((m) => (m.role === "user" ? { role: "user", text: m.text } : { role: "assistant", text: m.text }));
    const out: BotReply = { text: "", links: [], handoffReason: null, tools: [], usage: { inputTokens: 0, outputTokens: 0 } };
    const linked = new Map<string, ProductBrief>();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const turn = await this.ai.turn({ system, messages, tools: BOT_TOOLS });
      out.usage.inputTokens += turn.usage.inputTokens;
      out.usage.outputTokens += turn.usage.outputTokens;
      if (!turn.toolCalls.length) { out.text = turn.text.trim(); break; }

      messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw });
      const results = [];
      for (const call of turn.toolCalls) {
        const r = await this.run(call, input, out, linked);
        out.tools.push({ name: call.name, input: redact(call.name, call.input), outputPreview: r.output.slice(0, 500), ok: !r.isError });
        results.push({ id: call.id, name: call.name, output: r.output.slice(0, MAX_TOOL_OUTPUT), isError: r.isError });
      }
      messages.push({ role: "tool", results });
    }

    out.links = [...linked.values()].slice(0, MAX_LINKS).map(linkMessage);
    if (!out.text) {
      // The model kept calling tools or answered with nothing: never leave the customer without an answer.
      out.text = FALLBACK_REPLY;
      out.handoffReason ??= "Bot bu soruya cevap üretemedi.";
    }
    return out;
  }

  private async run(call: AiToolCall, input: BotTurnInput, out: BotReply, linked: Map<string, ProductBrief>): Promise<{ output: string; isError?: boolean }> {
    const a = call.input;
    const json = (v: unknown) => ({ output: JSON.stringify(v) });
    try {
      switch (call.name) {
        case "search_products": {
          const query = str(a.query);
          if (!query) return { output: "query boş olamaz.", isError: true };
          const maxPrice = typeof a.max_price === "number" && a.max_price > 0 ? Math.round(a.max_price * 100) : null;
          const found = await this.knowledge.searchProducts(query, { inStockOnly: a.in_stock_only === true, maxPriceMinor: maxPrice, limit: 6 });
          return json(found.length ? { sonuclar: found.map(brief) } : { sonuclar: [], not: "Bu aramayla ürün bulunamadı. Daha genel bir kelime deneyebilir ya da müşteriye ne aradığını sorabilirsin." });
        }
        case "get_product": {
          const p = await this.knowledge.product(str(a.product_id));
          return p ? json(detail(p)) : { output: "Bu id ile yayında bir ürün yok. search_products ile yeniden ara.", isError: true };
        }
        case "send_product_links": {
          const ids = (Array.isArray(a.product_ids) ? a.product_ids : []).filter((v): v is string => typeof v === "string").slice(0, MAX_LINKS);
          const found = await this.knowledge.productsByIds(ids);
          if (!found.length) return { output: "Bu id'lerle ürün bulunamadı; bağlantı gönderilmedi.", isError: true };
          for (const p of found) linked.set(p.id, p);
          return json({ gonderilecek: found.map((p) => p.name), not: "Bağlantılar cevabından hemen sonra ayrı mesaj olarak gidecek. Cevabında adresi yazma, yalnız bağlantıyı gönderdiğini söyle." });
        }
        case "search_store_content": {
          const hits = await this.knowledge.searchContent(str(a.query));
          return json(hits.length ? { bolumler: hits } : { bolumler: [], not: "Site içeriğinde bu konuda bilgi bulunamadı. Tahmin etme; kontrol edip dönüş yapılacağını söyle, gerekirse devret." });
        }
        case "get_shipping_info": {
          const s = await this.knowledge.shipping();
          return json({
            kargo_secenekleri: s.methods.map((m) => ({ ad: m.name, ucret: m.feeMinor === 0 ? "ücretsiz" : formatMinor(m.feeMinor), ucretsiz_kargo_siniri: money(m.freeAboveMinor) })),
            tahmini_teslim: s.estimate ?? "Mağaza teslim tahmini vermiyor.",
          });
        }
        case "get_order_status": {
          const order = await this.knowledge.orderStatus(str(a.order_number), { email: str(a.email) || null, phones: [str(a.phone), input.contactPhone ?? ""].filter(Boolean) });
          if (!order) return json({ dogrulandi: false, not: "Sipariş numarası ile e-posta / telefon eşleşmedi. Sipariş hakkında hiçbir bilgi verme; bilgileri kontrol etmesini iste." });
          return json({
            dogrulandi: true, siparis_no: order.orderNumber, tarih: dayFmt.format(new Date(order.placedAt)), durum: order.statusLabel, odeme: order.paymentLabel, tutar: formatMinor(order.totalMinor),
            urunler: order.items.map((i) => `${i.quantity} × ${i.name}`),
            gonderiler: order.shipments.map((s) => ({ durum: s.statusLabel, takip_no: s.trackingNumber, takip_baglantisi: s.trackingUrl, kargoya_verildi: s.shippedAt && dayFmt.format(new Date(s.shippedAt)), teslim: s.deliveredAt && dayFmt.format(new Date(s.deliveredAt)) })),
          });
        }
        case "handoff_to_human": {
          out.handoffReason = str(a.reason).slice(0, 280) || "Müşteri bir temsilciyle görüşmek istedi.";
          return { output: "Konuşma ekibe devredildi, personele bildirim gitti. Müşteriye bir ekip arkadaşının en kısa sürede yazacağını kısaca söyle." };
        }
        default:
          return { output: `Bilinmeyen araç: ${call.name}`, isError: true };
      }
    } catch (err) {
      this.logger.warn("social ai tool failed", { tool: call.name, error: err instanceof Error ? err.message : String(err) });
      return { output: "Bu bilgiye şu an ulaşılamadı. Tahmin etme; kontrol edip dönüş yapılacağını söyle.", isError: true };
    }
  }
}
