/**
 * Social AI Marketing — pure types and rules (no I/O), safe for client components. An AI assistant answers WhatsApp and
 * Instagram messages with the shop's catalog and content. Everything channel specific sits behind a `ChannelAdapter`;
 * the rules here (messaging window, working hours, message splitting) are shared by every channel.
 */
export const CHANNELS = {
  whatsapp: {
    label: "WhatsApp", contactLabel: "Telefon",
    /** Characters of one text message (Cloud API text body limit). */
    textLimit: 4096, limitUnit: "chars",
    /** Hours after the customer's last message in which free-form messages may be sent. */
    windowHours: 24,
    /** WhatsApp has no longer window for human agents: outside 24 h only approved templates (not in this version). */
    humanAgentWindowHours: 24,
  },
  instagram: {
    label: "Instagram", contactLabel: "Instagram kimliği",
    /** Instagram counts UTF-8 bytes ("1000 bytes or less"). */
    textLimit: 1000, limitUnit: "bytes",
    windowHours: 24,
    /** Replies written by a person may use the human agent tag: 7 days. */
    humanAgentWindowHours: 168,
  },
} as const;
export type Channel = keyof typeof CHANNELS;
export const CHANNEL_KEYS = Object.keys(CHANNELS) as Channel[];
export const isChannel = (v: string): v is Channel => v in CHANNELS;

export const RETENTION_DAYS = 30;
/** Graph API version of every Meta call and of the JS SDK the WhatsApp wizard loads (checked 2026-11-16). */
export const META_GRAPH_VERSION = "v27.0";
/** Hosts the panel talks to during WhatsApp Embedded Signup (Facebook JS SDK popup) — added to the admin CSP. */
export const META_SDK_CSP = { connectSrc: ["https://www.facebook.com", "https://web.facebook.com", "https://graph.facebook.com", "https://connect.facebook.net"], frameSrc: ["https://www.facebook.com", "https://web.facebook.com"] };
/** Messages people type in pieces are collected this long before the bot answers them together. */
export const REPLY_DEBOUNCE_MS = 4000;
/** The bot sees this many latest messages of the conversation. */
export const HISTORY_LIMIT = 24;
export const STAFF_MESSAGE_MAX = 1000;

export const CONVERSATION_STATUSES = {
  bot: { label: "Bot cevaplıyor", tone: "violet" },
  handoff: { label: "Devredildi", tone: "amber" },
  closed: { label: "Kapandı", tone: "slate" },
} as const;
export type ConversationStatus = keyof typeof CONVERSATION_STATUSES;
export const CONVERSATION_STATUS_KEYS = Object.keys(CONVERSATION_STATUSES) as ConversationStatus[];

export const TONES = {
  friendly: { label: "Samimi", hint: "Sıcak, içten, senli benli ama saygılı.", prompt: "Sıcak ve samimi yaz; müşteriyle içten ama saygılı konuş." },
  corporate: { label: "Kurumsal", hint: "Resmi, net, sizli.", prompt: "Kurumsal ve net yaz; müşteriye siz diye hitap et, emoji kullanma." },
  young: { label: "Genç", hint: "Enerjik, kısa, ölçülü emoji.", prompt: "Genç ve enerjik yaz; kısa cümleler kur, ölçülü emoji kullanabilirsin." },
} as const;
export type Tone = keyof typeof TONES;
export const TONE_KEYS = Object.keys(TONES) as Tone[];

export const MAX_EXAMPLES = 10;
export interface BotExample { question: string; answer: string }
export interface WorkingHours { days: number[]; from: string; to: string }

export interface BotSettings {
  tone: Tone;
  toneNote: string;
  welcomeMessage: string;
  rulesText: string;
  bansText: string;
  examples: BotExample[];
  hoursEnabled: boolean;
  hours: WorkingHours;
  offHoursMessage: string;
  handoffRules: string;
  conversationLimit: number;
  dailyLimit: number;
}
export interface BotSettingsView extends BotSettings { updatedAt: string; updatedByName: string | null }

export const DEFAULT_HOURS: WorkingHours = { days: [1, 2, 3, 4, 5, 6, 7], from: "09:00", to: "22:00" };

export const REFERRAL_TYPES = { ad: "Reklam", post: "Gönderi", ref: "Bağlantı kodu (ref)" } as const;
export type ReferralType = keyof typeof REFERRAL_TYPES;
export const REFERRAL_TYPE_KEYS = Object.keys(REFERRAL_TYPES) as ReferralType[];
export const MAX_REFERRAL_PRODUCTS = 8;

/** Where a conversation came from (click-to-message ad, post, ig.me / wa.me link with a ref). */
export interface Referral {
  type: ReferralType;
  /** Ad id, post id or the ref code. */
  sourceId: string | null;
  ref: string | null;
  headline: string | null;
  body: string | null;
  url: string | null;
}

export interface ReferralMap {
  id: string;
  sourceType: ReferralType;
  sourceId: string;
  label: string;
  productIds: string[];
  extraPrompt: string;
  isActive: boolean;
  updatedAt: string;
}
export interface ReferralMapView extends ReferralMap { products: { id: string; name: string }[] }

/** One customer message as every channel delivers it to the conversation service. */
export interface InboundMessage {
  channel: Channel;
  /** Our own account the message was sent to (WhatsApp phone number id / Instagram account id). */
  accountId: string;
  contactId: string;
  contactName: string | null;
  externalId: string;
  /** Text, or a short placeholder for content the bot cannot read ("[görsel]"). */
  text: string;
  at: string;
  referral: Referral | null;
}

export type MessageStatus = "received" | "pending" | "sent" | "failed" | "blocked";
export type MessageSender = "customer" | "bot" | "staff";
export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  received: "Alındı", pending: "Gönderiliyor", sent: "Gönderildi", failed: "Gönderilemedi", blocked: "Pencere kapalı: gönderilmedi",
};

export interface MessageView {
  id: string;
  direction: "in" | "out";
  sender: MessageSender;
  authorName: string | null;
  body: string;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
}

export interface ToolCallView {
  id: string;
  messageId: string | null;
  name: string;
  input: Record<string, unknown>;
  outputPreview: string;
  ok: boolean;
  createdAt: string;
}

export interface WindowState {
  open: boolean;
  /** When free-form messages stop being allowed; null = the customer never wrote. */
  closesAt: string | null;
}

export interface ConversationSummary {
  id: string;
  channel: Channel;
  contactId: string;
  contactName: string | null;
  /** Read from the channel's profile (Instagram); null until fetched or where the channel has none. */
  contactUsername: string | null;
  contactAvatarUrl: string | null;
  status: ConversationStatus;
  referralSource: string | null;
  referralLabel: string | null;
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastSender: MessageSender | null;
  staffUnread: number;
  handoffReason: string | null;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  referral: Referral | null;
  messages: MessageView[];
  toolCalls: ToolCallView[];
  /** Window for a reply written by staff (Instagram: human agent window). */
  staffWindow: WindowState;
}

export interface ConversationList {
  rows: ConversationSummary[];
  total: number;
  counts: Record<ConversationStatus | "all", number>;
  /** Referral sources seen in the kept conversations (filter options). */
  sources: { id: string; label: string }[];
}

/** The shop's Meta app as the panel shows it (never the secrets). */
export interface MetaAppView {
  appId: string | null;
  igAppId: string | null;
  waConfigId: string | null;
  appSecretSet: boolean;
  igAppSecretSet: boolean;
  verifyToken: string;
  webhookUrl: string;
  instagramRedirectUri: string;
  updatedAt: string;
}

export interface ChannelView {
  channel: Channel;
  isEnabled: boolean;
  status: "connected" | "error";
  externalId: string;
  accountId: string | null;
  displayName: string | null;
  tokenExpiresAt: string | null;
  connectedVia: "oauth" | "manual";
  welcomeMessage: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastInboundAt: string | null;
  connectedAt: string;
  connectedByName: string | null;
  updatedAt: string;
}

export interface ChannelStats {
  inboundToday: number;
  repliesToday: number;
  handoffsOpen: number;
  /** Latest outgoing messages that were not delivered. */
  failures: { id: string; conversationId: string; at: string; status: MessageStatus; error: string | null }[];
}

export interface AiReadiness { ready: boolean; provider: string | null; model: string | null }

/** Everything a channel page needs: AI readiness, the Meta app, the connection (null = set-up wizard) and today's numbers. */
export interface ChannelOverview {
  channel: Channel;
  ai: AiReadiness;
  app: MetaAppView;
  /** The app fields this channel needs are filled in. */
  appReady: boolean;
  connection: ChannelView | null;
  stats: ChannelStats;
  retentionDays: number;
  /** https is required by Meta for webhooks and OAuth redirects. */
  publicUrlIsHttps: boolean;
}

const HOUR_MS = 3_600_000;
const TR_OFFSET_MS = 3 * HOUR_MS;

/** May a free-form message be sent now? `humanAgent` = written by staff (Instagram allows 7 days for those). */
export function windowState(channel: Channel, lastInboundAt: string | null, now: Date, humanAgent = false): WindowState {
  if (!lastInboundAt) return { open: false, closesAt: null };
  const hours = humanAgent ? CHANNELS[channel].humanAgentWindowHours : CHANNELS[channel].windowHours;
  const closes = Date.parse(lastInboundAt) + hours * HOUR_MS;
  return { open: now.getTime() < closes, closesAt: new Date(closes).toISOString() };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const isClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Working hours on Istanbul time (fixed UTC+3). A range that ends before it starts runs past midnight. */
export function withinHours(hours: WorkingHours, now: Date): boolean {
  const local = new Date(now.getTime() + TR_OFFSET_MS);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const weekday = ((local.getUTCDay() + 6) % 7) + 1;
  const from = minutesOf(hours.from), to = minutesOf(hours.to);
  if (from === to) return hours.days.includes(weekday);
  if (from < to) return hours.days.includes(weekday) && minutes >= from && minutes < to;
  // Overnight: the part after midnight belongs to the previous day's shift.
  return (hours.days.includes(weekday) && minutes >= from) || (hours.days.includes(weekday === 1 ? 7 : weekday - 1) && minutes < to);
}

const encoder = new TextEncoder();
const sizeOf = (text: string, unit: "chars" | "bytes") => (unit === "bytes" ? encoder.encode(text).length : text.length);

/** Splits an answer into messages the channel accepts, at paragraph / line / sentence / word ends when it can. */
export function splitMessage(text: string, channel: Channel): string[] {
  const { textLimit: limit, limitUnit: unit } = CHANNELS[channel];
  const out: string[] = [];
  let rest = text.trim();
  while (rest && sizeOf(rest, unit) > limit) {
    let cut = Math.min(rest.length, limit);
    // Bytes: multi-byte letters (ş, ğ, emoji) make the head longer than its character count.
    while (cut > 1 && sizeOf(rest.slice(0, cut), unit) > limit) cut--;
    const head = rest.slice(0, cut);
    const at = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"), head.lastIndexOf(". ") + 1, head.lastIndexOf(" "));
    const end = at > cut * 0.5 ? at : cut;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

export function previewOf(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Collapses whitespace runs; keeps single line breaks (same rule as live support). */
export function cleanMessage(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** "+90 532 *** ** 67" style mask for lists shown without customers.read. */
export function maskContact(channel: Channel, contactId: string): string {
  if (channel !== "whatsapp" || contactId.length < 7) return contactId.length > 6 ? `${contactId.slice(0, 3)}…${contactId.slice(-2)}` : contactId;
  return `+${contactId.slice(0, 5)}*****${contactId.slice(-2)}`;
}

export const digitsOf = (v: string) => v.replace(/\D/g, "");
/** Two phone numbers are the same person when their last 10 digits match (national number without country / trunk prefix). */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digitsOf(a ?? ""), y = digitsOf(b ?? "");
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

/** KVKK aydınlatma metnine eklenmesi önerilen cümle (panelde gösterilir). */
export const KVKK_SENTENCE =
  "WhatsApp ve Instagram üzerinden bize yazdığınız mesajlar, sorularınızı yanıtlamak amacıyla yapay zekâ destekli bir asistan tarafından işlenir; mesaj içerikleri en fazla 30 gün saklanır ve bu sürenin sonunda kalıcı olarak silinir.";
