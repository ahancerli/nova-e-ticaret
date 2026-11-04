import { UnitOfWork, decryptSecret, encryptSecret, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { MailErrors } from "../domain/errors";
import { buildMime, emailLayout, escapeHtml, type MailMessage, type MailSettingsInput, type MailSettingsView } from "../domain/mail";
import type { MailIntegrationRepository, MailSender, SealedPassword, SmtpTransport, StoredMailIntegration } from "./ports";

const KEY_VERSION = "v1";

export interface MailDeps {
  db: Database;
  repo: MailIntegrationRepository;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  /** SECRETS_MASTER_KEY (base64, 32 bytes). */
  masterKey: string;
  transport: SmtpTransport;
}

const viewOf = (s: StoredMailIntegration): MailSettingsView => ({
  host: s.host, port: s.port, security: s.security, username: s.username, fromEmail: s.fromEmail, fromName: s.fromName,
  passwordSet: true, updatedAt: s.updatedAt, updatedBy: s.updatedByName,
});

/** Query: SMTP settings for the panel (never the password). */
export class GetMailSettings {
  constructor(private readonly repo: MailIntegrationRepository) {}
  async execute(): Promise<MailSettingsView | null> {
    const s = await this.repo.find();
    return s ? viewOf(s) : null;
  }
}

/** Command: save SMTP settings. The password is sealed with the master key; empty = keep the stored one. */
export class SaveMailSettings {
  constructor(private readonly deps: MailDeps) {}

  async execute(input: MailSettingsInput, actor: Actor): Promise<MailSettingsView> {
    const { deps } = this;
    const existing = await deps.repo.find();
    if ((existing?.updatedAt ?? null) !== input.expectedUpdatedAt) throw MailErrors.changedMeanwhile();
    const plain = input.password ?? "";
    if (!plain && !existing) throw MailErrors.passwordRequired();
    if (plain && !deps.masterKey) throw MailErrors.masterKeyMissing();

    const password: SealedPassword | null = plain ? { ...(await encryptSecret(deps.masterKey, plain)), keyVersion: KEY_VERSION } : null;
    const now = deps.clock.nowIso();
    const row = {
      host: input.host.trim().toLowerCase(), port: input.port, security: input.security, username: input.username.trim(),
      fromEmail: input.fromEmail.trim().toLowerCase(), fromName: input.fromName.trim(), actorId: actor.userId, now,
    };
    const uow = new UnitOfWork(deps.db);
    if (existing) uow.add(deps.repo.updateStatement({ ...row, password }, existing.updatedAt)).expectChanges(1, MailErrors.changedMeanwhile);
    else uow.add(deps.repo.insertStatement({ ...row, password: password! }));
    await uow
      .add(deps.audit.recordStatement({
        actor, action: existing ? "mail_integration.update" : "mail_integration.create", entityType: "mail_integration", entityId: "smtp",
        // the password itself never reaches the audit log
        diff: { host: row.host, port: row.port, security: row.security, username: row.username, fromEmail: row.fromEmail, passwordChanged: !!password },
      }))
      .commit();
    return viewOf((await deps.repo.find())!);
  }
}

/** Command: remove the SMTP settings; e-mails (password reset) stop until new settings are saved. */
export class RemoveMailSettings {
  constructor(private readonly deps: MailDeps) {}

  async execute(expectedUpdatedAt: string, actor: Actor): Promise<void> {
    const existing = await this.deps.repo.find();
    if (!existing) throw MailErrors.notConfigured();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.deleteStatement(expectedUpdatedAt))
      .expectChanges(1, MailErrors.changedMeanwhile)
      .add(this.deps.audit.recordStatement({ actor, action: "mail_integration.delete", entityType: "mail_integration", entityId: "smtp", diff: { host: existing.host } }))
      .commit();
  }
}

/** Sends through the stored SMTP account. The port other modules use (identity: password reset). */
export class SmtpMailSender implements MailSender {
  constructor(private readonly deps: MailDeps) {}

  async send(message: MailMessage): Promise<"sent" | "not_configured"> {
    const stored = await this.deps.repo.find();
    if (!stored) return "not_configured";
    if (!this.deps.masterKey) throw MailErrors.masterKeyMissing();
    let password: string;
    try {
      password = await decryptSecret(this.deps.masterKey, stored.password);
    } catch {
      throw MailErrors.passwordUnreadable(); // master key rotated / row tampered
    }
    const mime = buildMime(message, { email: stored.fromEmail, name: stored.fromName }, this.deps.clock.now(), this.deps.ids.newId());
    await this.deps.transport.send(
      { host: stored.host, port: stored.port, security: stored.security, username: stored.username, password },
      { from: stored.fromEmail, to: message.to }, mime,
    );
    return "sent";
  }
}

/** Command: a test e-mail to the signed-in admin — proves host, port, security and credentials together. */
export class SendTestMail {
  constructor(private readonly sender: MailSender, private readonly repo: MailIntegrationRepository) {}

  async execute(actor: Actor & { email: string; displayName: string }): Promise<{ to: string; latencyMs: number }> {
    const stored = await this.repo.find();
    if (!stored) throw MailErrors.notConfigured();
    const started = Date.now();
    await this.sender.send({
      to: actor.email, toName: actor.displayName, subject: `${stored.fromName}: SMTP test e-postası`,
      text: `Merhaba ${actor.displayName},\n\nBu e-postayı aldıysanız SMTP ayarlarınız çalışıyor. Parola sıfırlama e-postaları bu hesaptan gönderilecek.\n`,
      html: emailLayout(stored.fromName, `<p>Merhaba ${escapeHtml(actor.displayName)},</p><p>Bu e-postayı aldıysanız <b>SMTP ayarlarınız çalışıyor</b>. Parola sıfırlama e-postaları bu hesaptan gönderilecek.</p>`),
    });
    return { to: actor.email, latencyMs: Date.now() - started };
  }
}
