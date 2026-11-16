import { decryptSecret, encryptSecret, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AiChat } from "@/modules/ai";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { NotificationPublisher } from "@/modules/notifications";
import { SocialAiErrors } from "../domain/errors";
import { CHANNELS, type Channel } from "../domain/social-ai";
import type { D1SocialAiRepository, StoredChannel } from "../infrastructure/d1-social-ai.repository";
import type { BotBrain } from "./bot-brain";
import type { ChannelAdapters, ChannelCredentials, MetaConnect, Sealed, StoreKnowledge } from "./ports";

export interface SocialAiDeps {
  db: Database;
  repo: D1SocialAiRepository;
  audit: AuditLog;
  notifications: NotificationPublisher;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** SECRETS_MASTER_KEY (base64, 32 bytes). */
  masterKey: string;
  keyVersion: string;
  /** Signs the Instagram login state (same secret as sessions). */
  sessionSecret: string;
  siteUrl: string;
  adapters: ChannelAdapters;
  meta: MetaConnect;
  ai: AiChat;
  knowledge: StoreKnowledge;
  brain: BotBrain;
}

export const CONVERSATION_HREF = (id: string) => `/admin/social-ai/konusmalar?konusma=${id}`;
export const CHANNEL_HREF: Record<Channel, string> = { whatsapp: "/admin/social-ai/whatsapp", instagram: "/admin/social-ai/instagram" };

export async function seal(deps: Pick<SocialAiDeps, "masterKey" | "keyVersion">, plain: string): Promise<Sealed> {
  if (!deps.masterKey) throw SocialAiErrors.masterKeyMissing();
  return { ...(await encryptSecret(deps.masterKey, plain)), keyVersion: deps.keyVersion };
}

export async function unseal(deps: Pick<SocialAiDeps, "masterKey">, sealed: Sealed): Promise<string> {
  if (!deps.masterKey) throw SocialAiErrors.masterKeyMissing();
  try {
    return await decryptSecret(deps.masterKey, sealed);
  } catch {
    throw SocialAiErrors.secretUnreadable(); // master key rotated / row tampered
  }
}

export interface AppSecrets { appSecret: string | null; igAppSecret: string | null }

export async function appSecrets(deps: Pick<SocialAiDeps, "masterKey" | "repo">): Promise<AppSecrets> {
  const app = await deps.repo.app();
  if (!app.secrets) return { appSecret: null, igAppSecret: null };
  const parsed = JSON.parse(await unseal(deps, app.secrets)) as Partial<AppSecrets>;
  return { appSecret: parsed.appSecret || null, igAppSecret: parsed.igAppSecret || null };
}

export async function credentialsOf(deps: Pick<SocialAiDeps, "masterKey">, ch: StoredChannel): Promise<ChannelCredentials> {
  return { externalId: ch.externalId, accountId: ch.accountId, accessToken: await unseal(deps, ch.token) };
}

/** The module only works with an AI integration (panel: Entegrasyonlar › AI entegrasyonları). */
export async function assertAiReady(deps: Pick<SocialAiDeps, "ai">): Promise<void> {
  if (!(await deps.ai.status()).ready) throw SocialAiErrors.aiRequired();
}

/** Start of the current day on Istanbul time (fixed UTC+3), as UTC ISO. */
export function istanbulDayStart(now: Date): string {
  const local = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 3 * 3_600_000).toISOString();
}

/** Marks the channel broken and tells staff once a day (same UoW-less path for the sender and the token refresher). */
export async function reportChannelError(deps: Pick<SocialAiDeps, "db" | "repo" | "notifications" | "clock">, channel: Channel, error: string): Promise<void> {
  const now = deps.clock.nowIso();
  const statements = await deps.notifications.statements({
    type: "social_ai.channel_error", title: `${CHANNELS[channel].label} bağlantısında sorun var`,
    body: `${error.slice(0, 300)} Kanal sayfasından bağlantıyı test edin ya da yeniden bağlayın.`, href: CHANNEL_HREF[channel], entityType: "social_ai_channel", entityId: channel,
    dedupeKey: `social_ai.channel_error:${channel}:${now.slice(0, 10)}`,
  });
  await deps.db.batch([deps.repo.channelErrorStatement(channel, error, now), ...statements]);
}
