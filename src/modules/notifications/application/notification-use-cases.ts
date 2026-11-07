import { UnitOfWork, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import { emailLayout, escapeHtml, type MailSender } from "@/modules/mail";
import type { HandlerOutcome } from "@/modules/outbox";
import type { Actor } from "@/modules/shared/actor";
import { NotificationErrors } from "../domain/errors";
import {
  MAX_RULE_RECIPIENTS, NOTIFICATION_TYPES, NOTIFICATION_TYPE_KEYS, RETENTION_DAYS, isNotificationType, normalizeNotification, parseRecipients,
  type NotificationInput, type NotificationRule, type NotificationType,
} from "../domain/notification";
import type { NotificationListQuery, NotificationPublisher, NotificationRepository, StoredRule, Viewer } from "./ports";

const DAY_MS = 86_400_000;

async function effectiveRule(repo: NotificationRepository, type: NotificationType): Promise<StoredRule> {
  const d = NOTIFICATION_TYPES[type].defaults;
  return (await repo.rule(type)) ?? { type, inApp: d.inApp, email: d.email, emailTo: null };
}

/**
 * NotificationPublisher: in-app row (permission of the type, dedupe key) + an outbox event for the e-mail copy, both
 * inside the producer's UnitOfWork. Old notifications are pruned on the way (retention).
 */
export class PublishNotification implements NotificationPublisher {
  constructor(private readonly repo: NotificationRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}

  async statements(input: NotificationInput) {
    const n = normalizeNotification(input);
    const rule = await effectiveRule(this.repo, n.type);
    const recipients = rule.email ? parseRecipients(rule.emailTo) : [];
    const id = this.ids.newId();
    const now = this.clock.nowIso();
    const out = [];
    if (rule.inApp) {
      out.push(this.repo.insertStatement(id, n, NOTIFICATION_TYPES[n.type].permission, now));
      out.push(this.repo.pruneStatement(new Date(Date.parse(now) - RETENTION_DAYS * DAY_MS).toISOString()));
    }
    if (recipients.length) {
      out.push(this.repo.emailOutboxStatement(this.ids.newId(), { recipients, title: n.title, body: n.body, href: n.href, type: n.type }, `notif-mail:${n.dedupeKey ?? id}`));
    }
    return out;
  }

  dismissStatement(type: NotificationType, entityType: string, entityIds: string[]) {
    return this.repo.dismissStatement(type, entityType, entityIds);
  }
}

/** Convenience for producers without a business transaction of their own (outbox handlers). */
export class RaiseNotification {
  constructor(private readonly db: Database, private readonly publisher: NotificationPublisher) {}

  async execute(n: NotificationInput): Promise<void> {
    const stmts = await this.publisher.statements(n);
    if (stmts.length) await new UnitOfWork(this.db).add(...stmts).commit();
  }
}

export class ListNotifications {
  constructor(private readonly repo: NotificationRepository) {}
  execute(viewer: Viewer, q: NotificationListQuery) { return this.repo.list(viewer, q); }
}

export class GetNotificationSummary {
  constructor(private readonly repo: NotificationRepository) {}
  execute(viewer: Viewer) { return this.repo.summary(viewer, 8); }
}

/** Read / unread / archive for the viewer only (others keep their own state). */
export class UpdateNotificationState {
  constructor(private readonly db: Database, private readonly repo: NotificationRepository, private readonly clock: Clock) {}

  async markRead(viewer: Viewer, ids: string[] | "all", read: boolean): Promise<void> {
    if (ids !== "all" && !ids.length) return;
    await this.db.batch([this.repo.markReadStatement(viewer, ids, read, this.clock.nowIso())]);
  }

  async archive(viewer: Viewer, ids: string[], archived: boolean): Promise<void> {
    if (!ids.length) return;
    await this.db.batch([this.repo.archiveStatement(viewer, ids, archived, this.clock.nowIso())]);
  }
}

/** Shop-wide rules per type (Bildirimler › Ayarlar, `settings.write`). */
export class GetNotificationRules {
  constructor(private readonly repo: NotificationRepository) {}

  async execute(): Promise<NotificationRule[]> {
    const stored = new Map((await this.repo.rules()).map((r) => [r.type, r]));
    return NOTIFICATION_TYPE_KEYS.map((type) => {
      const def = NOTIFICATION_TYPES[type];
      const r = stored.get(type);
      return {
        type, label: def.label, description: def.description,
        inApp: r?.inApp ?? def.defaults.inApp, email: r?.email ?? def.defaults.email, emailTo: parseRecipients(r?.emailTo ?? null),
      };
    });
  }
}

export class UpdateNotificationRules {
  constructor(private readonly db: Database, private readonly repo: NotificationRepository, private readonly audit: AuditLog, private readonly clock: Clock) {}

  async execute(rules: { type: string; inApp: boolean; email: boolean; emailTo: string[] }[], actor: Actor): Promise<void> {
    const now = this.clock.nowIso();
    const uow = new UnitOfWork(this.db);
    for (const r of rules) {
      if (!isNotificationType(r.type)) throw NotificationErrors.unknownType(r.type);
      const emailTo = [...new Set(r.emailTo.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, MAX_RULE_RECIPIENTS);
      if (r.email && !emailTo.length) throw NotificationErrors.recipientsRequired(NOTIFICATION_TYPES[r.type].label);
      uow.add(this.repo.upsertRuleStatement({ type: r.type, inApp: r.inApp, email: r.email, emailTo: emailTo.join(", ") || null }, actor.userId, now));
    }
    await uow
      .add(this.audit.recordStatement({ actor, action: "notification_rule.update", entityType: "notification_rule", entityId: "all", diff: { rules: rules.map((r) => ({ type: r.type, inApp: r.inApp, email: r.email, recipients: r.emailTo.length })) } }))
      .commit();
  }
}

/** Personal mutes: a staff member hides types they do not want to see. */
export class NotificationPreferences {
  constructor(private readonly db: Database, private readonly repo: NotificationRepository) {}

  async get(userId: string): Promise<{ muted: string[] }> {
    return { muted: await this.repo.mutes(userId) };
  }

  async set(userId: string, muted: string[]): Promise<void> {
    for (const t of muted) if (!isNotificationType(t)) throw NotificationErrors.unknownType(t);
    await new UnitOfWork(this.db).add(...this.repo.replaceMutesStatements(userId, [...new Set(muted)])).commit();
  }
}

/** Outbox handler `admin_notification.email`: the e-mail copy of a notification to the rule's fixed recipients. */
export class SendNotificationEmail {
  constructor(private readonly mail: MailSender, private readonly siteName: () => Promise<string>, private readonly siteUrl: string, private readonly logger: Logger) {}

  async handle(payload: Record<string, unknown>): Promise<HandlerOutcome> {
    const recipients = Array.isArray(payload.recipients) ? payload.recipients.filter((r): r is string => typeof r === "string") : [];
    const title = typeof payload.title === "string" ? payload.title : "";
    if (!recipients.length || !title) return { result: "skipped", detail: "empty" };
    const body = typeof payload.body === "string" ? payload.body : "";
    const link = typeof payload.href === "string" ? `${this.siteUrl}${payload.href}` : null;
    const brand = await this.siteName();
    const sent: string[] = [];
    for (const to of recipients) {
      const r = await this.mail.send({
        purpose: "other", to, subject: `[${brand}] ${title}`,
        text: [title, body, link ? `Panelde aç: ${link}` : ""].filter(Boolean).join("\n\n"),
        html: emailLayout(brand, `<p style="font-size:16px;font-weight:bold">${escapeHtml(title)}</p>${body ? `<p>${escapeHtml(body)}</p>` : ""}${link ? `<p><a href="${escapeHtml(link)}">Panelde aç</a></p>` : ""}`),
      });
      if (r === "not_configured") {
        this.logger.warn("notification e-mail skipped: SMTP not configured", { title });
        return { result: "skipped", detail: "smtp_not_configured" };
      }
      sent.push(to);
    }
    return { result: "done", detail: { channel: "email", sent: sent.length } };
  }
}
