import { UnitOfWork, hmacHex, randomToken, safeEqual } from "@/core";
import { formatMinor } from "@/lib/money";
import type { Actor } from "@/modules/shared/actor";
import { SocialAiErrors } from "../domain/errors";
import type { ReferralContext } from "../domain/prompt";
import {
  RETENTION_DAYS,
  type BotSettings, type BotSettingsView, type Channel, type ChannelOverview, type ChannelView, type MetaAppView, type ReferralMap, type ReferralMapView, type ReferralType,
} from "../domain/social-ai";
import type { StoredApp, StoredChannel } from "../infrastructure/d1-social-ai.repository";
import { INSTAGRAM_SCOPES } from "../infrastructure/http-meta-connect";
import type { ToolTrace } from "./bot-brain";
import type { ConnectedAccount } from "./ports";
import { appSecrets, assertAiReady, credentialsOf, istanbulDayStart, seal, type AppSecrets, type SocialAiDeps } from "./shared";

export const WEBHOOK_PATH = "/api/webhooks/meta";
export const INSTAGRAM_CALLBACK_PATH = "/api/admin/social-ai/instagram/callback";
/** The Instagram consent screen must come back within this time. */
const STATE_TTL_MS = 15 * 60_000;

/** Everything but the sealed token. */
const channelView = (c: StoredChannel): ChannelView => ({
  channel: c.channel, isEnabled: c.isEnabled, status: c.status, externalId: c.externalId, accountId: c.accountId, displayName: c.displayName, tokenExpiresAt: c.tokenExpiresAt,
  connectedVia: c.connectedVia, welcomeMessage: c.welcomeMessage, lastError: c.lastError, lastErrorAt: c.lastErrorAt, lastInboundAt: c.lastInboundAt, connectedAt: c.connectedAt,
  connectedByName: c.connectedByName, updatedAt: c.updatedAt,
});

function appView(app: StoredApp, secrets: AppSecrets, siteUrl: string): MetaAppView {
  return {
    appId: app.appId, igAppId: app.igAppId, waConfigId: app.waConfigId, appSecretSet: !!secrets.appSecret, igAppSecretSet: !!secrets.igAppSecret, verifyToken: app.verifyToken,
    webhookUrl: `${siteUrl}${WEBHOOK_PATH}`, instagramRedirectUri: `${siteUrl}${INSTAGRAM_CALLBACK_PATH}`, updatedAt: app.updatedAt,
  };
}

/** What each channel's wizard needs from the Meta app. */
const appReadyFor = (channel: Channel, app: StoredApp, s: AppSecrets) =>
  channel === "whatsapp" ? !!(app.appId && s.appSecret && app.waConfigId) : !!(app.igAppId && s.igAppSecret);

/** Query: everything a channel page shows (wizard when `connection` is null, status screen otherwise). */
export class GetChannelOverview {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(channel: Channel): Promise<ChannelOverview> {
    const { repo } = this.deps;
    const [ai, app, connection, stats] = await Promise.all([
      this.deps.ai.status(), repo.app(), repo.channel(channel), repo.stats(channel, istanbulDayStart(this.deps.clock.now())),
    ]);
    // An unreadable secret must not take the page down: the panel shows the secret as "not set".
    const secrets = await appSecrets(this.deps).catch(() => ({ appSecret: null, igAppSecret: null }));
    return {
      channel, ai, app: appView(app, secrets, this.deps.siteUrl), appReady: appReadyFor(channel, app, secrets), connection: connection ? channelView(connection) : null, stats,
      retentionDays: RETENTION_DAYS, publicUrlIsHttps: this.deps.siteUrl.startsWith("https://"),
    };
  }
}

export interface MetaAppInput {
  appId: string | null;
  /** Empty = keep the stored secret. */
  appSecret?: string | null;
  igAppId: string | null;
  igAppSecret?: string | null;
  waConfigId: string | null;
  expectedUpdatedAt: string;
}

/** Command: the shop's own Meta app (entered once by whoever installs the shop). Secrets are sealed together. */
export class SaveMetaApp {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(input: MetaAppInput, actor: Actor): Promise<MetaAppView> {
    const { repo } = this.deps;
    const current = await appSecrets(this.deps).catch(() => ({ appSecret: null, igAppSecret: null }));
    const next: AppSecrets = { appSecret: input.appSecret?.trim() || current.appSecret, igAppSecret: input.igAppSecret?.trim() || current.igAppSecret };
    const changed = !!input.appSecret?.trim() || !!input.igAppSecret?.trim();
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(repo.saveAppStatement({
        appId: input.appId?.trim() || null, igAppId: input.igAppId?.trim() || null, waConfigId: input.waConfigId?.trim() || null,
        secrets: changed ? await seal(this.deps, JSON.stringify(next)) : null, actorId: actor.userId, now,
      }, input.expectedUpdatedAt))
      .expectChanges(1, SocialAiErrors.appChanged)
      .add(this.deps.audit.recordStatement({
        actor, action: "social_ai.app_update", entityType: "social_ai_channel", entityId: "meta_app",
        diff: { appId: input.appId?.trim() || null, igAppId: input.igAppId?.trim() || null, waConfigId: input.waConfigId?.trim() || null, secretsChanged: changed },
      }))
      .commit();
    return appView(await repo.app(), next, this.deps.siteUrl);
  }
}

abstract class ConnectCommand {
  constructor(protected readonly deps: SocialAiDeps) {}

  protected async save(channel: Channel, account: ConnectedAccount, via: "oauth" | "manual", actor: Actor): Promise<ChannelView> {
    const { repo, clock } = this.deps;
    const now = clock.now();
    await new UnitOfWork(this.deps.db)
      .add(...repo.connectStatements({
        channel, externalId: account.externalId, accountId: account.accountId, displayName: account.displayName?.slice(0, 120) ?? null, token: await seal(this.deps, account.accessToken),
        tokenExpiresAt: account.expiresIn ? new Date(now.getTime() + account.expiresIn * 1000).toISOString() : null, via, actorId: actor.userId, now: now.toISOString(),
      }))
      .add(this.deps.audit.recordStatement({ actor, action: "social_ai.channel_connect", entityType: "social_ai_channel", entityId: channel, diff: { externalId: account.externalId, via } }))
      .commit();
    return channelView((await repo.channel(channel))!);
  }
}

/** Command: finish WhatsApp Embedded Signup (the popup gave a code plus the WABA and phone number ids). */
export class ConnectWhatsApp extends ConnectCommand {
  async execute(input: { code: string; wabaId: string; phoneNumberId: string }, actor: Actor): Promise<ChannelView> {
    await assertAiReady(this.deps);
    const [app, secrets] = await Promise.all([this.deps.repo.app(), appSecrets(this.deps)]);
    if (!app.appId || !secrets.appSecret) throw SocialAiErrors.appNotReady();
    return this.save("whatsapp", await this.deps.meta.connectWhatsApp({ appId: app.appId, appSecret: secrets.appSecret }, input), "oauth", actor);
  }
}

/** State of an Instagram login in flight: `<expiry>.<nonce>.<hmac>`, kept in an HttpOnly cookie and echoed by Instagram. */
async function signState(secret: string, expires: number, nonce: string) {
  return `${expires}.${nonce}.${await hmacHex(secret, `social-ai-ig:${expires}.${nonce}`)}`;
}

/** Command: where to send the browser for "Instagram ile bağlan". */
export class StartInstagramLogin {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(): Promise<{ url: string; state: string; maxAgeSec: number }> {
    await assertAiReady(this.deps);
    const [app, secrets] = await Promise.all([this.deps.repo.app(), appSecrets(this.deps)]);
    if (!app.igAppId || !secrets.igAppSecret) throw SocialAiErrors.appNotReady();
    if (!this.deps.siteUrl.startsWith("https://")) throw SocialAiErrors.httpsRequired();
    const state = await signState(this.deps.sessionSecret, this.deps.clock.now().getTime() + STATE_TTL_MS, randomToken(16));
    // Authorize endpoint and scope names: Instagram Platform › Business login (checked 2026-11-16).
    const query = new URLSearchParams({
      client_id: app.igAppId, redirect_uri: `${this.deps.siteUrl}${INSTAGRAM_CALLBACK_PATH}`, response_type: "code", scope: INSTAGRAM_SCOPES, state, force_reauth: "true",
    });
    return { url: `https://www.instagram.com/oauth/authorize?${query}`, state, maxAgeSec: STATE_TTL_MS / 1000 };
  }
}

/** Command: Instagram sent the browser back with a code. */
export class CompleteInstagramLogin extends ConnectCommand {
  async execute(input: { code: string | null; state: string | null; cookieState: string | null; denied: boolean }, actor: Actor): Promise<ChannelView> {
    if (input.denied) throw SocialAiErrors.denied();
    const [expires, nonce] = (input.state ?? "").split(".");
    const valid = !!input.state && !!input.cookieState && safeEqual(input.state, input.cookieState) && !!expires && !!nonce
      && safeEqual(input.state, await signState(this.deps.sessionSecret, Number(expires), nonce)) && Number(expires) > this.deps.clock.now().getTime();
    if (!valid || !input.code) throw SocialAiErrors.stateInvalid();
    const [app, secrets] = await Promise.all([this.deps.repo.app(), appSecrets(this.deps)]);
    if (!app.igAppId || !secrets.igAppSecret) throw SocialAiErrors.appNotReady();
    const account = await this.deps.meta.connectInstagram(
      { igAppId: app.igAppId, igAppSecret: secrets.igAppSecret },
      // Instagram appends "#_" to the redirect; the code itself never contains it.
      { code: input.code.replace(/#_$/, ""), redirectUri: `${this.deps.siteUrl}${INSTAGRAM_CALLBACK_PATH}` },
    );
    return this.save("instagram", account, "oauth", actor);
  }
}

/** Command: development / fallback path — ids and a token typed in by hand, checked at Meta before they are stored. */
export class ConnectManually extends ConnectCommand {
  async execute(channel: Channel, input: { externalId: string; accountId?: string | null; accessToken: string }, actor: Actor): Promise<ChannelView> {
    await assertAiReady(this.deps);
    const secrets = await appSecrets(this.deps);
    // Without the app secret no webhook could be verified: the channel would connect and never answer.
    if (!(channel === "whatsapp" ? secrets.appSecret : secrets.igAppSecret ?? secrets.appSecret)) throw SocialAiErrors.appNotReady();
    const credentials = { externalId: input.externalId.trim(), accountId: input.accountId?.trim() || null, accessToken: input.accessToken.trim() };
    const { displayName } = await this.deps.meta.verify(channel, credentials);
    return this.save(channel, { ...credentials, displayName, expiresIn: null }, "manual", actor);
  }
}

/** Command: bot on / off for the channel and its own welcome message. */
export class UpdateChannel {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(channel: Channel, input: { isEnabled: boolean; welcomeMessage?: string | null; expectedUpdatedAt: string }, actor: Actor): Promise<ChannelView> {
    const { repo } = this.deps;
    const current = await repo.channel(channel);
    if (!current) throw SocialAiErrors.notConnected();
    if (input.isEnabled && !current.isEnabled) await assertAiReady(this.deps);
    const welcomeMessage = input.welcomeMessage === undefined ? current.welcomeMessage : input.welcomeMessage?.trim() || null;
    await new UnitOfWork(this.deps.db)
      .add(repo.updateChannelStatement(channel, { isEnabled: input.isEnabled, welcomeMessage, now: this.deps.clock.nowIso() }, input.expectedUpdatedAt))
      .expectChanges(1, SocialAiErrors.channelChanged)
      .add(this.deps.audit.recordStatement({
        actor, action: "social_ai.channel_update", entityType: "social_ai_channel", entityId: channel, diff: { isEnabled: { from: current.isEnabled, to: input.isEnabled }, welcomeChanged: welcomeMessage !== current.welcomeMessage },
      }))
      .commit();
    return channelView((await repo.channel(channel))!);
  }
}

/** Command: "Bağlantıyı kes" — the token is deleted here and the webhook subscription removed at Meta (best effort). */
export class DisconnectChannel {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(channel: Channel, actor: Actor): Promise<void> {
    const { repo } = this.deps;
    const current = await repo.channel(channel);
    if (!current) return;
    await new UnitOfWork(this.deps.db)
      .add(repo.disconnectStatement(channel))
      .add(this.deps.audit.recordStatement({ actor, action: "social_ai.channel_disconnect", entityType: "social_ai_channel", entityId: channel, diff: { externalId: current.externalId } }))
      .commit();
    try { await this.deps.meta.unsubscribe(channel, await credentialsOf(this.deps, current)); } catch { /* the local disconnect stands */ }
  }
}

/** Command: "Bağlantıyı test et" — reads the account with the stored token and renews the webhook subscription. */
export class TestChannel {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(channel: Channel): Promise<{ ok: true; displayName: string | null }> {
    const current = await this.deps.repo.channel(channel);
    if (!current) throw SocialAiErrors.notConnected();
    try {
      const { displayName } = await this.deps.meta.verify(channel, await credentialsOf(this.deps, current));
      await this.deps.db.batch([this.deps.repo.channelErrorStatement(channel, null, this.deps.clock.nowIso())]);
      return { ok: true, displayName };
    } catch (err) {
      await this.deps.db.batch([this.deps.repo.channelErrorStatement(channel, err instanceof Error ? err.message : "Bağlantı testi başarısız.", this.deps.clock.nowIso())]);
      throw err;
    }
  }
}

// --- bot settings -----------------------------------------------------------------------------------------------

export class GetBotSettings {
  constructor(private readonly deps: SocialAiDeps) {}
  execute(): Promise<BotSettingsView> { return this.deps.repo.settings(); }
}

export class UpdateBotSettings {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(input: BotSettings & { expectedUpdatedAt: string }, actor: Actor): Promise<BotSettingsView> {
    const { expectedUpdatedAt, ...settings } = input;
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.saveSettingsStatement(settings, actor.userId, this.deps.clock.nowIso(), expectedUpdatedAt))
      .expectChanges(1, SocialAiErrors.settingsChanged)
      .add(this.deps.audit.recordStatement({
        actor, action: "social_ai.settings_update", entityType: "social_ai_settings", entityId: "default",
        diff: { tone: settings.tone, hoursEnabled: settings.hoursEnabled, examples: settings.examples.length, conversationLimit: settings.conversationLimit, dailyLimit: settings.dailyLimit },
      }))
      .commit();
    return this.deps.repo.settings();
  }
}

export interface ReferralMapInput {
  sourceType: ReferralType;
  sourceId: string;
  label: string;
  productIds: string[];
  extraPrompt: string;
  isActive: boolean;
  expectedUpdatedAt?: string | null;
}

export class ListReferralMaps {
  constructor(private readonly deps: SocialAiDeps) {}
  /** Published products the panel's picker offers. */
  productOptions(): Promise<{ id: string; name: string }[]> { return this.deps.repo.productOptions(); }
  async execute(): Promise<ReferralMapView[]> {
    const maps = await this.deps.repo.referralMaps();
    const names = new Map((await this.deps.repo.productNames(maps.flatMap((m) => m.productIds))).map((p) => [p.id, p.name]));
    return maps.map((m) => ({ ...m, products: m.productIds.map((id) => ({ id, name: names.get(id) ?? "Silinmiş ürün" })) }));
  }
}

/** Command: ad / post → products + extra instruction. Only published products can be mapped. */
export class SaveReferralMap {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(id: string | null, input: ReferralMapInput, actor: Actor): Promise<ReferralMap> {
    const { repo } = this.deps;
    const existing = id ? await repo.referralMap(id) : null;
    if (id && !existing) throw SocialAiErrors.referralNotFound();
    const sourceId = input.sourceId.trim();
    if (await repo.referralSourceTaken(input.sourceType, sourceId, id)) throw SocialAiErrors.referralExists();
    const productIds = [...new Set(input.productIds)];
    if (productIds.length && (await this.deps.knowledge.productsByIds(productIds)).length !== productIds.length) throw SocialAiErrors.productsUnknown();
    const now = this.deps.clock.nowIso();
    const map: ReferralMap = { id: id ?? this.deps.ids.newId(), sourceType: input.sourceType, sourceId, label: input.label.trim(), productIds, extraPrompt: input.extraPrompt.trim(), isActive: input.isActive, updatedAt: now };
    const uow = new UnitOfWork(this.deps.db);
    if (existing) uow.add(repo.updateReferralStatement(map, now, input.expectedUpdatedAt ?? existing.updatedAt)).expectChanges(1, SocialAiErrors.settingsChanged);
    else uow.add(repo.insertReferralStatement(map, now));
    await uow
      .add(this.deps.audit.recordStatement({
        actor, action: existing ? "social_ai.referral_update" : "social_ai.referral_create", entityType: "social_ai_referral", entityId: map.id,
        diff: { label: map.label, sourceType: map.sourceType, sourceId: map.sourceId, products: productIds.length, isActive: map.isActive },
      }))
      .commit();
    return map;
  }
}

export class DeleteReferralMap {
  constructor(private readonly deps: SocialAiDeps) {}
  async execute(id: string, actor: Actor): Promise<void> {
    const existing = await this.deps.repo.referralMap(id);
    if (!existing) throw SocialAiErrors.referralNotFound();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.deleteReferralStatement(id))
      .add(this.deps.audit.recordStatement({ actor, action: "social_ai.referral_delete", entityType: "social_ai_referral", entityId: id, diff: { label: existing.label, sourceId: existing.sourceId } }))
      .commit();
  }
}

export interface PreviewInput {
  channel: Channel;
  /** Draft settings from the form (not saved yet); omitted = the stored ones. */
  settings?: BotSettings;
  messages: { role: "user" | "assistant"; text: string }[];
  /** Try the conversation as if it came from this mapping. */
  referralMapId?: string | null;
}

/** Query: the panel's test chat. Runs the real bot (real catalog, real AI) but stores and sends nothing. */
export class PreviewBot {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(input: PreviewInput): Promise<{ messages: string[]; handoffReason: string | null; tools: ToolTrace[] }> {
    await assertAiReady(this.deps);
    const settings = input.settings ?? (await this.deps.repo.settings());
    const connection = await this.deps.repo.channel(input.channel);
    const map = input.referralMapId ? await this.deps.repo.referralMap(input.referralMapId) : null;
    let referral: ReferralContext | null = null;
    if (map) {
      const products = await this.deps.knowledge.productsByIds(map.productIds);
      referral = {
        referral: { type: map.sourceType, sourceId: map.sourceId, ref: null, headline: null, body: null, url: null }, label: map.label, extraPrompt: map.extraPrompt,
        products: products.map((p) => ({ id: p.id, name: p.name, priceText: p.priceMinor == null ? null : formatMinor(p.cartPriceMinor ?? p.priceMinor), inStock: p.inStock, url: p.url })),
      };
    }
    const reply = await this.deps.brain.reply({
      channel: input.channel, settings, welcomeMessage: connection?.welcomeMessage ?? settings.welcomeMessage, history: input.messages, referral,
      firstReply: !input.messages.some((m) => m.role === "assistant"), contactPhone: null,
    });
    return { messages: [reply.text, ...reply.links], handoffReason: reply.handoffReason, tools: reply.tools };
  }
}
