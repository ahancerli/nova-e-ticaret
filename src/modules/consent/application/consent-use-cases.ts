import { UnitOfWork, encryptSecret, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import {
  CONSENT_PROVIDERS, actionOf, consentRevision, resolveTexts,
  type BannerLayout, type BannerTextKey, type ConsentChoices, type ConsentProviderCode, type ConsentSettingsView, type ConsentSource,
  type GoogleConsentMode, type PublicConsentConfig,
} from "../domain/consent";
import { ConsentErrors as E } from "../domain/errors";
import { TAG_PROVIDER_BY_CODE, validateTagConfig, validateTagSecrets, type TrackingTagView } from "../domain/tags";
import type { ConsentRecordRow, ConsentRepository, ConsentSettingsRow, ConsentStats, CookiePolicySource, TrackingTagRow } from "./ports";

export interface ConsentDeps {
  db: Database;
  repo: ConsentRepository;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  policy: CookiePolicySource;
  /** SECRETS_MASTER_KEY (server-side tag keys); empty = keys cannot be stored. */
  masterKey: string;
}

const KEY_VERSION = "v1";

const settingsView = (s: ConsentSettingsRow): ConsentSettingsView => ({ ...s });
type SecretHints = { code: string; name: string; hint: string }[];
const tagView = (t: TrackingTagRow, hints: SecretHints): TrackingTagView => ({
  code: t.code, isActive: t.isActive, config: t.config, updatedAt: t.updatedAt,
  secrets: Object.fromEntries(hints.filter((h) => h.code === t.code).map((h) => [h.name, h.hint])),
});

/** A stored tag the storefront may load (and the server may send to): active, vendor adapter shipped, ids still valid. */
export const loadable = (t: TrackingTagRow) => {
  const def = TAG_PROVIDER_BY_CODE.get(t.code);
  return !!def && def.status === "ready" && t.isActive && Object.keys(validateTagConfig(def, t.config)).length === 0;
};

/** Query (storefront layout, every page): banner settings, current revision and the tags to load after consent. */
export class GetConsentConfig {
  constructor(private readonly repo: ConsentRepository, private readonly policy: CookiePolicySource) {}

  async execute(): Promise<PublicConsentConfig> {
    const [s, tags, policy, hints] = await Promise.all([this.repo.settings(), this.repo.tags(), this.policy(), this.repo.secretHints()]);
    // GA4 purchase goes from the server when its API secret is stored: the browser skips it (GA4 would count it twice)
    const serverPurchase = (code: string): Record<string, string> =>
      (code === "ga4" && hints.some((h) => h.code === code && h.name === "apiSecret") ? { serverPurchase: "1" } : {});
    const provider: ConsentProviderCode = CONSENT_PROVIDERS[s.provider].ready ? s.provider : "builtin";
    return {
      bannerEnabled: s.bannerEnabled, provider, providerConfig: provider === "builtin" ? {} : s.providerConfig, layout: s.layout,
      texts: resolveTexts(s.texts), googleConsentMode: s.googleConsentMode, maxAgeDays: s.maxAgeDays,
      revision: consentRevision(s.revision, policy?.version ?? null),
      policy: policy && { href: policy.href, title: policy.title },
      // banner off = nobody can consent → no optional tag may load
      tags: s.bannerEnabled
        ? tags.filter(loadable).map((t) => ({ code: t.code, category: TAG_PROVIDER_BY_CODE.get(t.code)!.category, config: { ...t.config, ...serverPurchase(t.code) } }))
        : [],
    };
  }
}

export interface ConsentAdminView {
  settings: ConsentSettingsView;
  tags: TrackingTagView[];
  /** Full revision string visitors are asked for (settings revision + cookie policy version). */
  revision: string;
  policy: { href: string; title: string; version: number } | null;
  stats30d: ConsentStats;
}

/** Query: panel page (settings, configured tags, last 30 days of choices). */
export class GetConsentAdmin {
  constructor(private readonly repo: ConsentRepository, private readonly policy: CookiePolicySource, private readonly clock: Clock) {}

  async execute(): Promise<ConsentAdminView> {
    const since = new Date(Date.parse(this.clock.nowIso()) - 30 * 86_400_000).toISOString();
    const [s, tags, policy, stats30d, hints] = await Promise.all([this.repo.settings(), this.repo.tags(), this.policy(), this.repo.stats(since), this.repo.secretHints()]);
    return { settings: settingsView(s), tags: tags.map((t) => tagView(t, hints)), revision: consentRevision(s.revision, policy?.version ?? null), policy, stats30d };
  }
}

export interface UpdateConsentSettingsInput {
  bannerEnabled: boolean;
  provider: ConsentProviderCode;
  providerConfig: Record<string, string>;
  layout: BannerLayout;
  texts: Partial<Record<BannerTextKey, string>>;
  googleConsentMode: GoogleConsentMode;
  maxAgeDays: number;
  expectedUpdatedAt: string;
}

/** Command: banner settings. An external CMP without an adapter is refused (same rule as SMS / cargo firms). */
export class UpdateConsentSettings {
  constructor(private readonly deps: ConsentDeps) {}

  async execute(input: UpdateConsentSettingsInput, actor: Actor): Promise<ConsentAdminView> {
    const { deps } = this;
    const provider = CONSENT_PROVIDERS[input.provider];
    if (!provider.ready) throw E.providerNotIntegrated(provider.label);
    const texts = Object.fromEntries(Object.entries(input.texts).map(([k, v]) => [k, v?.trim() ?? ""]).filter(([, v]) => v)) as Partial<Record<BannerTextKey, string>>;
    const row = { ...input, texts, providerConfig: input.provider === "builtin" ? {} : input.providerConfig };
    await new UnitOfWork(deps.db)
      .add(deps.repo.updateSettingsStatement({ ...row, actorId: actor.userId, now: deps.clock.nowIso() })).expectChanges(1, E.changedMeanwhile)
      .add(deps.audit.recordStatement({
        actor, action: "consent.update", entityType: "consent_settings", entityId: "1",
        diff: { bannerEnabled: row.bannerEnabled, provider: row.provider, layout: row.layout, googleConsentMode: row.googleConsentMode, maxAgeDays: row.maxAgeDays, texts: Object.keys(texts) },
      }))
      .commit();
    return new GetConsentAdmin(deps.repo, deps.policy, deps.clock).execute();
  }
}

/** Command: ask every visitor again (revision + 1), e.g. after the cookie usage changed outside the panel. */
export class RenewConsent {
  constructor(private readonly deps: ConsentDeps) {}

  async execute(actor: Actor): Promise<ConsentAdminView> {
    const { deps } = this;
    const before = await deps.repo.settings();
    await new UnitOfWork(deps.db)
      .add(deps.repo.bumpRevisionStatement(actor.userId, deps.clock.nowIso()))
      .add(deps.audit.recordStatement({ actor, action: "consent.renew", entityType: "consent_settings", entityId: "1", diff: { revision: before.revision + 1 } }))
      .commit();
    return new GetConsentAdmin(deps.repo, deps.policy, deps.clock).execute();
  }
}

export interface SaveTrackingTagInput {
  isActive: boolean;
  config: Record<string, string>;
  /** Server-side keys: a value replaces the stored one, null / "" removes it, a missing key keeps it. */
  secrets?: Record<string, string | null>;
  /** null = the tag is being added. */
  expectedUpdatedAt: string | null;
}

/**
 * Command: add / update one vendor tag. Activating a vendor that was not active bumps the consent revision: visitors
 * agreed to a list of vendors, a new one needs a new answer (KVKK: consent is specific).
 */
export class SaveTrackingTag {
  constructor(private readonly deps: ConsentDeps) {}

  async execute(code: string, input: SaveTrackingTagInput, actor: Actor): Promise<ConsentAdminView> {
    const { deps } = this;
    const def = TAG_PROVIDER_BY_CODE.get(code);
    if (!def) throw E.tagNotFound();
    if (def.status !== "ready") throw E.providerNotIntegrated(def.name);
    const config = Object.fromEntries(Object.entries(input.config).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const secrets = Object.fromEntries(Object.entries(input.secrets ?? {}).map(([k, v]) => [k, v?.trim() || null]));
    const errors = { ...validateTagConfig(def, config), ...validateTagSecrets(def, secrets) };
    if (!deps.masterKey) for (const [k, v] of Object.entries(secrets)) if (v) errors[`secrets.${k}`] = ["Sunucuda SECRETS_MASTER_KEY tanımlı değil; gizli anahtar saklanamaz."];
    if (Object.keys(errors).length) throw E.invalidConfig(errors);

    const current = await deps.repo.tag(code);
    if ((current?.updatedAt ?? null) !== input.expectedUpdatedAt) throw E.tagChangedMeanwhile();
    const now = deps.clock.nowIso();
    const uow = new UnitOfWork(deps.db);
    if (current) uow.add(deps.repo.updateTagStatement({ code, isActive: input.isActive, config, expectedUpdatedAt: current.updatedAt, actorId: actor.userId, now })).expectChanges(1, E.tagChangedMeanwhile);
    else uow.add(deps.repo.insertTagStatement({ code, isActive: input.isActive, config, actorId: actor.userId, now }));
    const newlyActive = input.isActive && !current?.isActive;
    if (newlyActive) uow.add(deps.repo.bumpRevisionStatement(actor.userId, now));
    // after the tag row (foreign key); the value is sealed here and never audited
    for (const [name, value] of Object.entries(secrets)) {
      if (!value) uow.add(deps.repo.deleteSecretStatement(code, name));
      else uow.add(deps.repo.upsertSecretStatement({ code, name, sealed: await encryptSecret(deps.masterKey, value), keyVersion: KEY_VERSION, hint: value.slice(-4), now }));
    }
    await uow
      .add(deps.audit.recordStatement({
        actor, action: current ? "tracking_tag.update" : "tracking_tag.create", entityType: "tracking_tag", entityId: code,
        diff: {
          isActive: input.isActive, config, ...(newlyActive ? { consentRenewed: true } : {}),
          ...(Object.keys(secrets).length ? { secrets: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v ? "set" : "removed"])) } : {}),
        },
      }))
      .commit();
    return new GetConsentAdmin(deps.repo, deps.policy, deps.clock).execute();
  }
}

/** Command: remove a vendor tag (no new consent needed: fewer vendors than agreed to). */
export class RemoveTrackingTag {
  constructor(private readonly deps: ConsentDeps) {}

  async execute(code: string, expectedUpdatedAt: string, actor: Actor): Promise<ConsentAdminView> {
    const { deps } = this;
    if (!(await deps.repo.tag(code))) throw E.tagNotFound();
    await new UnitOfWork(deps.db)
      .add(deps.repo.deleteTagStatement(code, expectedUpdatedAt)).expectChanges(1, E.tagChangedMeanwhile)
      .add(deps.audit.recordStatement({ actor, action: "tracking_tag.delete", entityType: "tracking_tag", entityId: code, diff: null }))
      .commit();
    return new GetConsentAdmin(deps.repo, deps.policy, deps.clock).execute();
  }
}

export interface RecordConsentInput {
  visitorId: string;
  revision: string;
  choices: ConsentChoices;
  source: ConsentSource;
}

/** Command (public): proof row for a choice the browser already applied. Never fails the visitor's page. */
export class RecordConsent {
  constructor(private readonly deps: Pick<ConsentDeps, "db" | "repo" | "clock" | "ids">) {}

  async execute(input: RecordConsentInput, ctx: { userId: string | null; ipHash: string | null; userAgent: string | null }): Promise<{ recorded: true }> {
    const { deps } = this;
    await new UnitOfWork(deps.db)
      .add(deps.repo.insertRecordStatement({
        id: deps.ids.newId(), visitorId: input.visitorId, userId: ctx.userId, revision: input.revision, choices: input.choices,
        action: actionOf(input.choices), source: input.source, ipHash: ctx.ipHash, userAgent: ctx.userAgent?.slice(0, 300) || null, now: deps.clock.nowIso(),
      }))
      .commit();
    return { recorded: true };
  }
}

/** Query: proof rows, newest first (panel; lookup by the visitor id a customer reads from their cookie). */
export class ListConsentRecords {
  constructor(private readonly repo: ConsentRepository) {}

  execute(filter: { visitorId?: string; page: number; pageSize: number }): Promise<{ rows: ConsentRecordRow[]; total: number }> {
    return this.repo.records({ visitorId: filter.visitorId, limit: filter.pageSize, offset: (filter.page - 1) * filter.pageSize });
  }
}
