import { ConflictError, UnitOfWork, ValidationError, decryptSecret, encryptSecret, type Clock, type Database, type IdGenerator, type Logger, type Statement } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { NotificationPublisher } from "@/modules/notifications";
import type { Actor } from "@/modules/shared/actor";
import {
  CHANNEL_OF, IYS_BATCH, MAX_IYS_ATTEMPTS, iysDate, iysEmail, iysPhone, iysRecipient, iysRetryMinutes,
  type IysChannel, type IysEnvironment, type IysOverview, type IysStatus,
} from "../domain/iys";
import type { D1IysRepository } from "../infrastructure/d1-iys.repository";
import { IysHttpError, type IysApi, type IysCredentials } from "../infrastructure/iys-client";

export interface IysDeps {
  db: Database;
  repo: D1IysRepository;
  api: IysApi;
  audit: AuditLog;
  notifications: NotificationPublisher;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  masterKey: string;
}

const KEY_VERSION = "v1";

/**
 * Port for modules that record a marketing consent decision (customers sign-up, newsletter): statements that queue
 * it for İYS in the SAME transaction as the consent row. A decision İYS cannot hold (non-Turkish mobile) is queued
 * as `skipped` so the panel can explain it. A withdrawal (RET) is always sent: İYS may hold an ONAY from elsewhere.
 */
export class IysQueue {
  constructor(private readonly repo: D1IysRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}

  statements(d: { consentId: string; purpose: string; granted: boolean; at: string; email?: string | null; phone?: string | null }): Statement[] {
    const channel = CHANNEL_OF[d.purpose];
    if (!channel) return [];
    const recipient = iysRecipient(channel, d);
    const status: IysStatus = d.granted ? "ONAY" : "RET";
    if (!recipient) {
      // nothing to withdraw at İYS for someone who could never be registered; an unusable "yes" is shown as skipped
      if (!d.granted || channel === "EPOSTA") return [];
      return [this.repo.enqueueStatement(this.ids.newId(), { consentId: d.consentId, channel, recipient: (d.phone ?? "?").slice(0, 254).padEnd(5, "?"), status, consentAt: d.at }, "skipped", this.clock.nowIso())];
    }
    return [this.repo.enqueueStatement(this.ids.newId(), { consentId: d.consentId, channel, recipient, status, consentAt: d.at }, "pending", this.clock.nowIso())];
  }
}

async function credentials(deps: Pick<IysDeps, "repo" | "masterKey">): Promise<IysCredentials | null> {
  const s = await deps.repo.settings();
  if (!s.isActive || !s.iysCode || !s.brandCode || !s.username || !s.sealedPassword || !deps.masterKey) return null;
  try {
    return { environment: s.environment, iysCode: s.iysCode, brandCode: s.brandCode, username: s.username, password: await decryptSecret(deps.masterKey, s.sealedPassword) };
  } catch {
    return null;
  }
}

/** Query: panel Entegrasyonlar › İYS. */
export class GetIysOverview {
  constructor(private readonly deps: IysDeps) {}

  async execute(): Promise<IysOverview> {
    const { repo, clock } = this.deps;
    const st = await repo.settings();
    const settings = {
      isActive: st.isActive, environment: st.environment, iysCode: st.iysCode, brandCode: st.brandCode, username: st.username, passwordSet: st.passwordSet,
      lastPushAt: st.lastPushAt, lastPullAt: st.lastPullAt, lastError: st.lastError, updatedAt: st.updatedAt,
    };
    // 3 business days ≈ 5 calendar days at worst (weekend); flag anything older still not at İYS
    const before = new Date(clock.now().getTime() - 5 * 86_400_000).toISOString();
    const [counts, overdue, recent] = await Promise.all([repo.counts(), repo.overdue(before), repo.recent(50)]);
    return {
      settings, counts, overdue,
      recent: recent.map((r) => ({ id: r.id, channel: r.channel, recipient: r.recipient, status: r.status, consentAt: r.consentAt, state: r.state, attempts: r.attempts, error: r.error, sentAt: r.sentAt, createdAt: r.createdAt })),
    };
  }
}

export interface IysSettingsInput {
  isActive: boolean;
  environment: IysEnvironment;
  iysCode: string;
  brandCode: string;
  username: string;
  /** Empty = keep the stored password. */
  password?: string | null;
  expectedUpdatedAt: string;
}

/** Command: store the İYS connection (password sealed); switching on needs a working sign-in. */
export class SaveIysSettings {
  constructor(private readonly deps: IysDeps) {}

  async execute(input: IysSettingsInput, actor: Actor): Promise<IysOverview> {
    const { deps } = this;
    const current = await deps.repo.settings();
    if (!input.password && !current.sealedPassword) throw ValidationError.field("password", "İYS API şifresini girin.", "iys_password_required");
    if (input.password && !deps.masterKey) throw new ConflictError("secrets_master_key_missing", "SECRETS_MASTER_KEY tanımlı değil.");
    if (input.isActive) {
      const password = input.password || (await decryptSecret(deps.masterKey, current.sealedPassword!).catch(() => ""));
      try {
        await deps.api.test({ environment: input.environment, iysCode: input.iysCode, brandCode: input.brandCode, username: input.username, password });
      } catch (e) {
        throw new ConflictError("iys_login_failed", `İYS bağlantısı kurulamadı: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const sealed = input.password ? { ...(await encryptSecret(deps.masterKey, input.password)), keyVersion: KEY_VERSION } : null;
    await new UnitOfWork(deps.db)
      .add(deps.repo.saveStatement({ ...input, password: sealed, actorId: actor.userId, now: deps.clock.nowIso() }))
      .expectChanges(1, () => new ConflictError("iys_settings_changed", "İYS ayarları bu sırada değişti. Sayfayı yenileyin."))
      .add(deps.audit.recordStatement({
        actor, action: "iys.update", entityType: "iys_settings", entityId: "1",
        diff: { isActive: input.isActive, environment: input.environment, iysCode: input.iysCode, brandCode: input.brandCode, username: input.username, passwordChanged: !!input.password },
      }))
      .commit();
    return new GetIysOverview(deps).execute();
  }
}

/** Command: sign in with the stored settings (panel "Bağlantıyı test et"). */
export class TestIys {
  constructor(private readonly deps: IysDeps) {}

  async execute(): Promise<{ ok: true; environment: IysEnvironment }> {
    const s = await this.deps.repo.settings();
    if (!s.iysCode || !s.brandCode || !s.username || !s.sealedPassword) throw new ConflictError("iys_not_configured", "Önce İYS bilgilerini kaydedin.");
    const password = await decryptSecret(this.deps.masterKey, s.sealedPassword);
    try {
      await this.deps.api.test({ environment: s.environment, iysCode: s.iysCode, brandCode: s.brandCode, username: s.username, password });
    } catch (e) {
      throw new ConflictError("iys_login_failed", `İYS bağlantısı kurulamadı: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { ok: true, environment: s.environment };
  }
}

/** Command: failed rows back into the queue (after fixing the cause, e.g. wrong brand code). */
export class RetryIysFailed {
  constructor(private readonly deps: IysDeps) {}
  async execute(): Promise<{ requeued: number }> { return { requeued: await this.deps.repo.retryFailed(this.deps.clock.nowIso()) }; }
}

/** Command (go-live): queue every current, never-sent marketing consent. */
export class BackfillIys {
  constructor(private readonly deps: IysDeps, private readonly queue: IysQueue) {}

  async execute(actor: Actor): Promise<{ queued: number }> {
    let queued = 0;
    for (;;) {
      const rows = await this.deps.repo.unqueuedGrants(200);
      if (!rows.length) break;
      const uow = new UnitOfWork(this.deps.db);
      let added = 0;
      for (const r of rows) {
        const st = this.queue.statements({ consentId: r.consentId, purpose: r.purpose, granted: true, at: r.recordedAt, email: r.email, phone: r.phone });
        // a consent İYS cannot hold still gets a row (skipped), so the loop never sees it again
        if (!st.length) st.push(this.deps.repo.enqueueStatement(this.deps.ids.newId(), { consentId: r.consentId, channel: CHANNEL_OF[r.purpose]!, recipient: (r.email ?? r.phone ?? "?????").slice(0, 254).padEnd(5, "?"), status: "ONAY", consentAt: r.recordedAt }, "skipped", this.deps.clock.nowIso()));
        uow.add(...st);
        added += st.length;
      }
      await uow.commit();
      queued += added;
      if (rows.length < 200) break;
    }
    await new UnitOfWork(this.deps.db).add(this.deps.audit.recordStatement({ actor, action: "iys.backfill", entityType: "iys_settings", entityId: "1", diff: { queued } })).commit();
    return { queued };
  }
}

export interface IysSyncResult { configured: boolean; sent: number; failed: number; retried: number; pulled: number; applied: number }

/**
 * Cron (/api/cron/iys, every 5 minutes): sends due queue rows one by one (İYS answers each with a transaction id),
 * then pulls changes recipients made directly at İYS and records them (withdrawals stop the newsletter too).
 * 4xx = the row is refused (kept with İYS's message); network / 5xx / 429 = retried with back-off.
 */
export class SyncIys {
  constructor(private readonly deps: IysDeps) {}

  async execute(): Promise<IysSyncResult> {
    const { deps } = this;
    const result: IysSyncResult = { configured: false, sent: 0, failed: 0, retried: 0, pulled: 0, applied: 0 };
    const creds = await credentials(deps);
    if (!creds) return result;
    result.configured = true;
    const now = deps.clock.nowIso();
    let lastError: string | null = null;

    for (const row of await deps.repo.due(now, IYS_BATCH)) {
      try {
        const r = await deps.api.addConsent(creds, { consentDate: iysDate(row.consentAt), source: row.source, recipient: row.recipient, status: row.status, type: row.channel });
        await deps.repo.markSent(row.id, r.transactionId, deps.clock.nowIso());
        result.sent++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (e instanceof IysHttpError && e.final) {
          await deps.repo.markFailed(row.id, e.code ? `${e.code}: ${message}` : message);
          result.failed++;
          continue;
        }
        const attempts = row.attempts + 1;
        if (attempts >= MAX_IYS_ATTEMPTS) { await deps.repo.markFailed(row.id, `İYS'ye ulaşılamadı: ${message}`); result.failed++; }
        else { await deps.repo.markRetry(row.id, message, attempts, new Date(deps.clock.now().getTime() + iysRetryMinutes(attempts) * 60_000).toISOString()); result.retried++; }
        lastError = message;
        break; // İYS unreachable: try the rest next run
      }
    }
    if (result.failed) {
      await new UnitOfWork(deps.db).add(...await deps.notifications.statements({
        type: "iys.failed", title: `${result.failed} izin kaydı İYS'ye gönderilemedi`, body: "Entegrasyonlar › İYS ekranında hatayı görüp düzeltin ve tekrar deneyin.",
        href: "/admin/entegrasyonlar/iys", entityType: "iys_settings", entityId: "1", dedupeKey: `iys.failed:${now.slice(0, 13)}`,
      })).commit();
    }

    // pull: changes made at İYS by the recipients themselves (the brand's own records are recognised by transaction id)
    try {
      const s = await deps.repo.settings();
      const page = await deps.api.changes(creds, s.changesCursor, 100);
      result.pulled = page.list.length;
      for (const c of page.list) if (await this.apply(c)) result.applied++;
      await deps.repo.noteSync({ pushAt: now, pullAt: deps.clock.nowIso(), cursor: page.after, error: lastError });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      deps.logger.warn("iys pull failed", { error: message });
      await deps.repo.noteSync({ pushAt: now, error: lastError ?? `Değişiklikler çekilemedi: ${message}` });
    }
    return result;
  }

  private async apply(c: { recipient: string; type: string; status: IysStatus; consentDate: string | null; transactionId: string | null }): Promise<boolean> {
    const { deps } = this;
    if (c.transactionId && (await deps.repo.ownTransaction(c.transactionId))) return false;
    const channel = c.type as IysChannel;
    const purpose = channel === "EPOSTA" ? "marketing_email" : channel === "MESAJ" ? "marketing_sms" : null;
    if (!purpose) return false;
    const recipient = channel === "EPOSTA" ? iysEmail(c.recipient) : iysPhone(c.recipient);
    if (!recipient) return false;
    const member = channel === "EPOSTA" ? await deps.repo.memberByEmail(recipient) : await deps.repo.memberByPhone(recipient);
    const now = deps.clock.nowIso();
    // the İYS time is Turkey time without zone: keep our own clock for the evidence row
    const uow = new UnitOfWork(deps.db);
    if (member) uow.add(deps.repo.consentStatement({ id: deps.ids.newId(), userId: member.id, guestHash: null, purpose, granted: c.status === "ONAY", at: now }));
    if (channel === "EPOSTA" && c.status === "RET") uow.add(deps.repo.unsubscribeNewsletterStatement(recipient, now));
    if (!uow.size) return false;
    await uow.commit();
    return true;
  }
}

export type { IysChannel };
