import { Repository, bit, bool, placeholders, type Statement } from "@/core";
import type { NotificationListQuery, NotificationRepository, StoredRule, Viewer } from "../application/ports";
import type { NotificationInput, NotificationSeverity, NotificationSummary, NotificationView } from "../domain/notification";

type Raw = {
  id: string; type: string; severity: NotificationSeverity; title: string; body: string | null; href: string | null;
  created_at: string; read_at: string | null; archived_at: string | null;
};

const toView = (r: Raw): NotificationView => ({
  id: r.id, type: r.type, severity: r.severity, title: r.title, body: r.body, href: r.href, createdAt: r.created_at, readAt: r.read_at, archivedAt: r.archived_at,
});

/**
 * Visibility of a notification for one staff member: permission held (or none required) and the type not muted.
 * Returns the SQL fragment (alias n, s = that member's state row) and its parameters, permissions bound as a list.
 */
function visible(viewer: Viewer): { join: string; where: string; params: unknown[] } {
  const perms = viewer.permissions.slice(0, 80);
  return {
    join: "LEFT JOIN admin_notification_states s ON s.notification_id = n.id AND s.user_id = ?",
    where: `(n.permission IS NULL${perms.length ? ` OR n.permission IN (${placeholders(perms.length)})` : ""})
            AND NOT EXISTS (SELECT 1 FROM admin_notification_mutes m WHERE m.user_id = ? AND m.type = n.type)`,
    params: [viewer.userId, ...perms, viewer.userId],
  };
}

const FILTER_SQL = { all: "s.archived_at IS NULL", unread: "s.archived_at IS NULL AND s.read_at IS NULL", archived: "s.archived_at IS NOT NULL" } as const;

export class D1NotificationRepository extends Repository implements NotificationRepository {
  async list(viewer: Viewer, q: NotificationListQuery) {
    const v = visible(viewer);
    const base = `FROM admin_notifications n ${v.join} WHERE ${v.where}`;
    const typeSql = q.type ? " AND n.type = ?" : "";
    const typeParams = q.type ? [q.type] : [];
    const [rows, total, unread] = await Promise.all([
      this.db.all<Raw>(
        `SELECT n.id, n.type, n.severity, n.title, n.body, n.href, n.created_at, s.read_at, s.archived_at ${base} AND ${FILTER_SQL[q.filter]}${typeSql}
          ORDER BY n.created_at DESC, n.id LIMIT ? OFFSET ?`,
        ...v.params, ...typeParams, q.pageSize, (q.page - 1) * q.pageSize,
      ),
      this.db.first<{ n: number }>(`SELECT COUNT(*) AS n ${base} AND ${FILTER_SQL[q.filter]}${typeSql}`, ...v.params, ...typeParams),
      this.db.first<{ n: number }>(`SELECT COUNT(*) AS n ${base} AND ${FILTER_SQL.unread}`, ...v.params),
    ]);
    return { rows: rows.map(toView), total: total?.n ?? 0, unread: unread?.n ?? 0 };
  }

  async summary(viewer: Viewer, latest: number): Promise<NotificationSummary> {
    const v = visible(viewer);
    const base = `FROM admin_notifications n ${v.join} WHERE ${v.where} AND s.archived_at IS NULL`;
    const [rows, unread] = await Promise.all([
      this.db.all<Raw>(`SELECT n.id, n.type, n.severity, n.title, n.body, n.href, n.created_at, s.read_at, s.archived_at ${base} ORDER BY n.created_at DESC, n.id LIMIT ?`, ...v.params, latest),
      this.db.first<{ n: number }>(`SELECT COUNT(*) AS n ${base} AND s.read_at IS NULL`, ...v.params),
    ]);
    return { unread: unread?.n ?? 0, latest: rows.map(toView) };
  }

  markReadStatement(viewer: Viewer, ids: string[] | "all", read: boolean, now: string): Statement {
    const v = visible(viewer);
    const idSql = ids === "all" ? "AND s.archived_at IS NULL" : `AND n.id IN (${placeholders(ids.length)})`;
    return this.db.statement(
      `INSERT INTO admin_notification_states (notification_id, user_id, read_at)
         SELECT n.id, ?, ? FROM admin_notifications n ${v.join} WHERE ${v.where} ${idSql}
       ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = CASE WHEN excluded.read_at IS NULL THEN NULL ELSE COALESCE(admin_notification_states.read_at, excluded.read_at) END`,
      viewer.userId, read ? now : null, ...v.params, ...(ids === "all" ? [] : ids),
    );
  }

  archiveStatement(viewer: Viewer, ids: string[], archived: boolean, now: string): Statement {
    const v = visible(viewer);
    return this.db.statement(
      `INSERT INTO admin_notification_states (notification_id, user_id, read_at, archived_at)
         SELECT n.id, ?, ?, ? FROM admin_notifications n ${v.join} WHERE ${v.where} AND n.id IN (${placeholders(ids.length)})
       ON CONFLICT (notification_id, user_id) DO UPDATE SET archived_at = excluded.archived_at, read_at = COALESCE(admin_notification_states.read_at, excluded.read_at)`,
      viewer.userId, archived ? now : null, archived ? now : null, ...v.params, ...ids,
    );
  }

  async rules(): Promise<StoredRule[]> {
    const rows = await this.db.all<{ type: string; in_app: number; email: number; email_to: string | null }>("SELECT type, in_app, email, email_to FROM admin_notification_rules");
    return rows.map((r) => ({ type: r.type, inApp: bool(r.in_app), email: bool(r.email), emailTo: r.email_to }));
  }

  async rule(type: string): Promise<StoredRule | null> {
    const r = await this.db.first<{ type: string; in_app: number; email: number; email_to: string | null }>("SELECT type, in_app, email, email_to FROM admin_notification_rules WHERE type = ?", type);
    return r ? { type: r.type, inApp: bool(r.in_app), email: bool(r.email), emailTo: r.email_to } : null;
  }

  upsertRuleStatement(rule: StoredRule, actorId: string, now: string): Statement {
    return this.db.statement(
      `INSERT INTO admin_notification_rules (type, in_app, email, email_to, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (type) DO UPDATE SET in_app = excluded.in_app, email = excluded.email, email_to = excluded.email_to,
                                        updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      rule.type, bit(rule.inApp), bit(rule.email), rule.emailTo, actorId, now,
    );
  }

  async mutes(userId: string): Promise<string[]> {
    return (await this.db.all<{ type: string }>("SELECT type FROM admin_notification_mutes WHERE user_id = ? ORDER BY type", userId)).map((r) => r.type);
  }

  replaceMutesStatements(userId: string, types: string[]): Statement[] {
    return [
      this.db.statement("DELETE FROM admin_notification_mutes WHERE user_id = ?", userId),
      ...types.map((t) => this.db.statement("INSERT INTO admin_notification_mutes (user_id, type) VALUES (?, ?)", userId, t)),
    ];
  }

  insertStatement(id: string, n: Required<NotificationInput>, permission: string, now: string): Statement {
    return this.db.statement(
      `INSERT OR IGNORE INTO admin_notifications (id, type, severity, title, body, href, permission, entity_type, entity_id, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, n.type, n.severity, n.title, n.body, n.href, permission, n.entityType, n.entityId, n.dedupeKey, now,
    );
  }

  pruneStatement(before: string): Statement {
    return this.db.statement("DELETE FROM admin_notifications WHERE created_at < ?", before);
  }

  dismissStatement(type: string, entityType: string, entityIds: string[]): Statement {
    return this.db.statement(
      `DELETE FROM admin_notifications WHERE type = ? AND entity_type = ? AND entity_id IN (${placeholders(entityIds.length)})`, type, entityType, ...entityIds,
    );
  }

  emailOutboxStatement(id: string, payload: Record<string, unknown>, dedupeKey: string): Statement {
    return this.db.statement(
      `INSERT OR IGNORE INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key)
       VALUES (?, 'admin_notification', ?, 'admin_notification.email', ?, ?)`,
      id, id, JSON.stringify(payload), dedupeKey,
    );
  }
}

export class D1OrderFacts extends Repository {
  async order(id: string) {
    const r = await this.db.first<{ order_number: string; total_minor: number; sales_channel: string; customer_email: string }>(
      "SELECT order_number, total_minor, sales_channel, customer_email FROM orders WHERE id = ?", id,
    );
    return r ? { orderNumber: r.order_number, totalMinor: r.total_minor, salesChannel: r.sales_channel, customerEmail: r.customer_email } : null;
  }
}
