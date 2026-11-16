import { z } from "zod";
import {
  CHANNEL_KEYS, CONVERSATION_STATUS_KEYS, MAX_EXAMPLES, MAX_REFERRAL_PRODUCTS, REFERRAL_TYPE_KEYS, STAFF_MESSAGE_MAX, TONE_KEYS, isClock,
  type Channel, type ConversationStatus, type ReferralType, type Tone,
} from "../domain/social-ai";

const channel = z.enum(CHANNEL_KEYS as [Channel, ...Channel[]]);
const metaId = (label: string) => z.string().trim().regex(/^\d{5,40}$/, `${label} yalnız rakamlardan oluşur.`);
const optionalMetaId = (label: string) => z.union([z.literal(""), metaId(label)]).nullish();
const stamp = z.string().min(1).max(40);

export const socialChannelParams = z.object({ channel });
export const socialIdParams = z.object({ id: z.string().min(1).max(80) });

export const metaAppSchema = z.object({
  appId: optionalMetaId("App ID"),
  appSecret: z.string().trim().max(200).nullish(),
  igAppId: optionalMetaId("Instagram App ID"),
  igAppSecret: z.string().trim().max(200).nullish(),
  waConfigId: optionalMetaId("Yapılandırma kimliği"),
  expectedUpdatedAt: stamp,
}).strict();

export const whatsappConnectSchema = z.object({
  code: z.string().trim().min(10, "Bağlantı kodu alınamadı. Pencereyi “Bitir” ile kapatın.").max(2000),
  wabaId: metaId("WhatsApp Business hesap kimliği"),
  phoneNumberId: metaId("Telefon numarası kimliği"),
}).strict();

export const manualConnectSchema = z.object({
  externalId: metaId("Hesap kimliği"),
  accountId: optionalMetaId("WhatsApp Business hesap kimliği"),
  accessToken: z.string().trim().min(20, "Erişim anahtarını girin.").max(2000),
}).strict();

export const channelUpdateSchema = z.object({
  isEnabled: z.boolean(),
  welcomeMessage: z.string().trim().max(500, "En fazla 500 karakter.").nullish(),
  expectedUpdatedAt: stamp,
}).strict();

const clock = z.string().refine(isClock, "Saati SS:DD biçiminde girin.");
const botSettingsFields = {
  tone: z.enum(TONE_KEYS as [Tone, ...Tone[]]),
  toneNote: z.string().trim().max(1000, "En fazla 1000 karakter."),
  welcomeMessage: z.string().trim().max(500, "En fazla 500 karakter."),
  rulesText: z.string().trim().max(4000, "En fazla 4000 karakter."),
  bansText: z.string().trim().max(2000, "En fazla 2000 karakter."),
  examples: z.array(z.object({
    question: z.string().trim().min(1, "Soruyu yazın.").max(300, "En fazla 300 karakter."),
    answer: z.string().trim().min(1, "Cevabı yazın.").max(600, "En fazla 600 karakter."),
  }).strict()).max(MAX_EXAMPLES, `En fazla ${MAX_EXAMPLES} örnek eklenebilir.`),
  hoursEnabled: z.boolean(),
  hours: z.object({
    days: z.array(z.number().int().min(1).max(7)).max(7).transform((d) => [...new Set(d)].sort()),
    from: clock, to: clock,
  }).strict(),
  offHoursMessage: z.string().trim().min(1, "Saat dışı mesajını yazın.").max(500, "En fazla 500 karakter."),
  handoffRules: z.string().trim().max(2000, "En fazla 2000 karakter."),
  conversationLimit: z.number().int().min(1, "En az 1.").max(500, "En fazla 500."),
  dailyLimit: z.number().int().min(1, "En az 1.").max(100000, "En fazla 100.000."),
};
const hoursNeedDays = (s: { hoursEnabled: boolean; hours: { days: number[] } }) => !s.hoursEnabled || s.hours.days.length > 0;
const hoursMessage = { path: ["hours", "days"], message: "En az bir gün seçin." };

export const botSettingsSchema = z.object({ ...botSettingsFields, expectedUpdatedAt: stamp }).strict().refine(hoursNeedDays, hoursMessage);

export const referralMapSchema = z.object({
  sourceType: z.enum(REFERRAL_TYPE_KEYS as [ReferralType, ...ReferralType[]]),
  sourceId: z.string().trim().min(1, "Reklam / gönderi kimliğini girin.").max(200),
  label: z.string().trim().min(1, "Bir ad verin.").max(120, "En fazla 120 karakter."),
  productIds: z.array(z.string().min(1).max(80)).max(MAX_REFERRAL_PRODUCTS, `En fazla ${MAX_REFERRAL_PRODUCTS} ürün seçilebilir.`),
  extraPrompt: z.string().trim().max(1000, "En fazla 1000 karakter."),
  isActive: z.boolean(),
  expectedUpdatedAt: stamp.nullish(),
}).strict();

export const previewSchema = z.object({
  channel,
  settings: z.object(botSettingsFields).strict().refine(hoursNeedDays, hoursMessage).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(2000) }).strict()).min(1).max(30)
    .refine((m) => m.at(-1)?.role === "user", "Son mesaj müşteriden olmalı."),
  referralMapId: z.string().max(80).nullish(),
}).strict();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const conversationQuerySchema = z.object({
  channel: channel.optional(),
  status: z.enum(CONVERSATION_STATUS_KEYS as [ConversationStatus, ...ConversationStatus[]]).optional(),
  source: z.string().max(200).optional(),
  from: day.optional(),
  to: day.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const conversationStatusSchema = z.object({ status: z.enum(CONVERSATION_STATUS_KEYS as [ConversationStatus, ...ConversationStatus[]]) }).strict();
export const staffReplySchema = z.object({ text: z.string().trim().min(1, "Mesajınızı yazın.").max(STAFF_MESSAGE_MAX, `Mesaj en fazla ${STAFF_MESSAGE_MAX} karakter.`) }).strict();
