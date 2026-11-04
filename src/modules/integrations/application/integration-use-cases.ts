import { UnitOfWork, encryptSecret, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { SecretVault } from "@/modules/platform/secrets";
import type { Actor } from "@/modules/shared/actor";
import { IntegrationErrors as E } from "../domain/errors";
import {
  KIND_LABEL, defaultSmsEvents, trMobile, validateValues,
  type IntegrationKind, type IntegrationPageView, type IntegrationSettings, type IntegrationView, type ProviderView, type SmsEvent, type SmsEventSetting,
} from "../domain/providers";
import type {
  CarrierConnector, Connector, ConnectorContext, ConnectorRegistry, IntegrationRepository, IntegrationRow, ProviderRow, SmsConnector,
} from "./ports";

const KEY_VERSION = "v1";

export interface IntegrationDeps {
  db: Database;
  repo: IntegrationRepository;
  vault: SecretVault;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  registry: ConnectorRegistry;
  /** SECRETS_MASTER_KEY (base64, 32 bytes). */
  masterKey: string;
}

/** Catalog says "ready" and the adapter of that kind ships with the app. */
const isReady = (p: ProviderRow, registry: ConnectorRegistry) => p.supportStatus === "ready" && registry.get(p.code)?.kind === p.kind;

const providerView = (p: ProviderRow, registry: ConnectorRegistry): ProviderView => ({
  code: p.code, kind: p.kind, name: p.name, description: p.description, website: p.website,
  status: isReady(p, registry) ? "ready" : "planned", fields: isReady(p, registry) ? p.fields : [], capabilities: p.capabilities,
});

function integrationView(row: IntegrationRow, provider: ProviderRow | null): IntegrationView {
  const secretKeys = new Set((provider?.fields ?? []).filter((f) => f.secret).map((f) => f.key));
  return {
    kind: row.kind, providerCode: row.providerCode, providerName: provider?.name ?? row.providerCode, isActive: row.isActive,
    values: Object.fromEntries(Object.entries(row.values).filter(([k]) => !secretKeys.has(k))),
    secretsSet: row.secrets.filter((s) => secretKeys.has(s)),
    settings: row.kind === "sms" ? { events: { ...defaultSmsEvents(), ...(row.settings.events ?? {}) } } : {},
    updatedAt: row.updatedAt,
  };
}

/** Query: provider catalog of a kind + the configured integration (no secret values). */
export class GetIntegrationPage {
  constructor(private readonly repo: IntegrationRepository, private readonly registry: ConnectorRegistry) {}

  async execute(kind: IntegrationKind): Promise<IntegrationPageView> {
    const [providers, current] = await Promise.all([this.repo.providers(kind), this.repo.current(kind)]);
    const provider = current ? (providers.find((p) => p.code === current.providerCode) ?? null) : null;
    return { kind, providers: providers.map((p) => providerView(p, this.registry)), current: current ? integrationView(current, provider) : null };
  }
}

export interface SaveIntegrationInput {
  providerCode: string;
  values: Record<string, string>;
  events?: Partial<Record<SmsEvent, SmsEventSetting>>;
  expectedUpdatedAt: string | null;
}

/**
 * Command: connect (or update) the kind's single integration. A firm without an adapter is refused with
 * provider_not_integrated. Choosing another firm replaces the previous one (its secrets are deleted with it).
 * Secret fields are sealed with the master key; an empty secret keeps the stored one (same firm only).
 */
export class SaveIntegration {
  constructor(private readonly deps: IntegrationDeps) {}

  async execute(kind: IntegrationKind, input: SaveIntegrationInput, actor: Actor): Promise<IntegrationPageView> {
    const { deps } = this;
    const provider = await deps.repo.provider(input.providerCode);
    if (!provider || provider.kind !== kind) throw E.providerNotFound();
    if (!isReady(provider, deps.registry)) throw E.providerNotIntegrated(provider.name);

    const current = await deps.repo.current(kind);
    if ((current?.updatedAt ?? null) !== input.expectedUpdatedAt) throw E.changedMeanwhile();
    const sameProvider = current?.providerCode === provider.code;
    const values = Object.fromEntries(Object.entries(input.values).map(([k, v]) => [k, v.trim()]));
    const fieldErrors = validateValues(provider.fields, values, sameProvider ? current!.secrets : []);
    if (Object.keys(fieldErrors).length) throw E.invalidValues(fieldErrors);

    const secretFields = provider.fields.filter((f) => f.secret && values[f.key]);
    if (secretFields.length && !deps.masterKey) throw E.masterKeyMissing();
    const publicValues = Object.fromEntries(provider.fields.filter((f) => !f.secret).map((f) => [f.key, values[f.key] || f.default || ""]));
    const settings: IntegrationSettings = kind === "sms" ? { events: { ...defaultSmsEvents(), ...(sameProvider ? current!.settings.events : {}), ...(input.events ?? {}) } } : {};
    const publicConfig = { values: publicValues, settings };

    const now = deps.clock.nowIso();
    const id = sameProvider ? current!.id : deps.ids.newId();
    const uow = new UnitOfWork(deps.db);
    if (current) uow.add(deps.repo.lockStatement(current.id, current.updatedAt)).expectChanges(1, E.changedMeanwhile);
    if (sameProvider) uow.add(deps.repo.updateStatement({ id, publicConfig, now }));
    else uow.add(deps.repo.deleteKindStatement(kind)).add(deps.repo.insertStatement({ id, kind, providerCode: provider.code, name: provider.name, publicConfig, now }));
    for (const f of secretFields) {
      const secret = { ...(await encryptSecret(deps.masterKey, values[f.key]!)), keyVersion: KEY_VERSION };
      for (const st of deps.repo.replaceSecretStatements({ id: deps.ids.newId(), integrationId: id, name: f.key, secret, now })) uow.add(st);
    }
    await uow
      .add(deps.audit.recordStatement({
        actor, action: current ? "integration.update" : "integration.create", entityType: "integration", entityId: kind,
        // secret values never reach the audit log
        diff: {
          provider: provider.code, ...(current && !sameProvider ? { replaced: current.providerCode } : {}), values: publicValues,
          secretsChanged: secretFields.map((f) => f.key),
          ...(settings.events ? { smsEvents: Object.entries(settings.events).filter(([, e]) => e?.enabled).map(([k]) => k) } : {}),
        },
      }))
      .commit();
    return new GetIntegrationPage(deps.repo, deps.registry).execute(kind);
  }
}

/** Command: disconnect the kind's integration (secrets are deleted with it). SMS stop; shipments fall back to manual. */
export class RemoveIntegration {
  constructor(private readonly deps: IntegrationDeps) {}

  async execute(kind: IntegrationKind, expectedUpdatedAt: string, actor: Actor): Promise<void> {
    const current = await this.deps.repo.current(kind);
    if (!current) throw E.notConfigured(KIND_LABEL[kind]);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.lockStatement(current.id, expectedUpdatedAt)).expectChanges(1, E.changedMeanwhile)
      .add(this.deps.repo.deleteKindStatement(kind))
      .add(this.deps.audit.recordStatement({ actor, action: "integration.delete", entityType: "integration", entityId: kind, diff: { provider: current.providerCode } }))
      .commit();
  }
}

export interface ActiveIntegration<C extends Connector> {
  integrationId: string;
  providerCode: string;
  providerName: string;
  connector: C;
  ctx: ConnectorContext;
  settings: IntegrationSettings;
}

/**
 * Port for other modules (shipping, notifications): the kind's active integration with its adapter and decrypted
 * credentials, or null (none, firm without adapter, unreadable secrets → callers fall back / skip).
 */
export class IntegrationRuntime {
  constructor(private readonly repo: IntegrationRepository, private readonly vault: SecretVault, private readonly registry: ConnectorRegistry) {}

  carrier(): Promise<ActiveIntegration<CarrierConnector> | null> {
    return this.active("shipping") as Promise<ActiveIntegration<CarrierConnector> | null>;
  }

  sms(): Promise<ActiveIntegration<SmsConnector> | null> {
    return this.active("sms") as Promise<ActiveIntegration<SmsConnector> | null>;
  }

  /** Like `active`, but explains why there is none (panel test button). */
  async require(kind: IntegrationKind): Promise<ActiveIntegration<Connector>> {
    const current = await this.repo.current(kind);
    if (!current?.isActive) throw E.notConfigured(KIND_LABEL[kind]);
    const r = await this.active(kind);
    if (!r) throw E.secretsUnreadable();
    return r;
  }

  private async active(kind: IntegrationKind): Promise<ActiveIntegration<Connector> | null> {
    const current = await this.repo.current(kind);
    if (!current?.isActive) return null;
    const connector = this.registry.get(current.providerCode);
    const provider = await this.repo.provider(current.providerCode);
    if (!connector || connector.kind !== kind || !provider) return null;
    const secrets: Record<string, string> = {};
    for (const f of provider.fields.filter((x) => x.secret)) {
      const v = await this.vault.read({ integrationId: current.id }, f.key);
      if (v === null) { if (f.required) return null; continue; }
      secrets[f.key] = v;
    }
    return { integrationId: current.id, providerCode: current.providerCode, providerName: provider.name, connector, ctx: { values: current.values, secrets }, settings: current.settings };
  }
}

/** Command: prove the stored settings — a test SMS to `phone`, or the carrier's credential check. */
export class TestIntegration {
  constructor(private readonly runtime: IntegrationRuntime, private readonly siteName: () => Promise<string>) {}

  async execute(kind: IntegrationKind, input: { phone?: string | null }): Promise<{ provider: string; latencyMs: number; to?: string }> {
    const active = await this.runtime.require(kind);
    const started = Date.now();
    if (active.connector.kind === "sms") {
      const to = trMobile(input.phone);
      if (!to) throw E.phoneRequired();
      await active.connector.send(active.ctx, { to: [to], text: `${await this.siteName()}: SMS ayarlarınız çalışıyor. Bu bir test mesajıdır.` });
      return { provider: active.providerName, latencyMs: Date.now() - started, to: `0${to}` };
    }
    await active.connector.test(active.ctx);
    return { provider: active.providerName, latencyMs: Date.now() - started };
  }
}
