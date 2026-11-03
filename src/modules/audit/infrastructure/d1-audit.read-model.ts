import { Repository } from "@/core";
import type { AuditReadModel } from "../application/ports";
import {
  AREA_OF_PREFIX, AUDIT_AREAS, ENTITY_LABELS, actionLabel, areaOf, entityHref, istanbulDayRange, redactDiff,
  type AuditArea, type AuditEntryDetail, type AuditEntrySummary, type AuditFilterOptions, type AuditList, type AuditQuery,
} from "../domain/audit";

const AREAS = Object.keys(AUDIT_AREAS) as AuditArea[];

// Area of a row, computed in SQL from the first action segment. Values come from the AREA_OF_PREFIX constant only.
const PREFIX_SQL = "CASE WHEN instr(a.action, '.') > 0 THEN substr(a.action, 1, instr(a.action, '.') - 1) ELSE a.action END";
const AREA_SQL = `CASE ${PREFIX_SQL} ${Object.entries(AREA_OF_PREFIX).map(([p, area]) => `WHEN '${p}' THEN '${area}'`).join(" ")} ELSE 'other' END`;

// Current name of the record. Evaluated only for the rows of a page (see `enrich`).
const ENTITY_NAME_SQL = `CASE a.entity_type
  WHEN 'order' THEN (SELECT order_number FROM orders WHERE id = a.entity_id)
  WHEN 'product' THEN (SELECT name FROM products WHERE id = a.entity_id)
  WHEN 'category' THEN (SELECT name FROM categories WHERE id = a.entity_id)
  WHEN 'brand' THEN (SELECT name FROM brands WHERE id = a.entity_id)
  WHEN 'campaign' THEN (SELECT name FROM campaigns WHERE id = a.entity_id)
  WHEN 'coupon' THEN (SELECT code_normalized FROM coupons WHERE id = a.entity_id)
  WHEN 'content_page' THEN (SELECT title FROM content_pages WHERE id = a.entity_id)
  WHEN 'user' THEN (SELECT display_name FROM users WHERE id = a.entity_id)
  WHEN 'role' THEN (SELECT name FROM roles WHERE id = a.entity_id)
  ELSE NULL END`;

/** Wraps a row source (`src`, aliased `a`) with actor and record columns. */
const enrich = (src: string) => `
  SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.request_id, a.actor_id,
         u.display_name AS actor_name, u.email_normalized AS actor_email,
         ${ENTITY_NAME_SQL} AS entity_name,
         CASE WHEN a.entity_type = 'user' THEN EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.user_id = a.entity_id) ELSE 0 END AS entity_is_staff
    FROM (${src}) a LEFT JOIN users u ON u.id = a.actor_id`;

type Raw = {
  id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; request_id: string | null;
  actor_id: string | null; actor_name: string | null; actor_email: string | null; entity_name: string | null; entity_is_staff: number;
};

const summaryOf = (r: Raw): AuditEntrySummary => ({
  id: r.id, createdAt: r.created_at, action: r.action, actionLabel: actionLabel(r.action), area: areaOf(r.action),
  entityType: r.entity_type, entityLabel: ENTITY_LABELS[r.entity_type] ?? r.entity_type, entityId: r.entity_id, entityName: r.entity_name,
  entityHref: entityHref(r.entity_type, r.entity_id, { isStaff: r.entity_is_staff === 1 }),
  actor: r.actor_id ? { id: r.actor_id, name: r.actor_name ?? "Silinmiş kullanıcı", email: r.actor_email ?? "" } : null,
  requestId: r.request_id,
});

const likeOf = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export class D1AuditReadModel extends Repository implements AuditReadModel {
  async list(q: AuditQuery): Promise<AuditList> {
    const where: string[] = [];
    const params: unknown[] = [];
    const { fromIso, toIso } = istanbulDayRange(q.from, q.to);
    if (fromIso) { where.push("a.created_at >= ?"); params.push(fromIso); }
    if (toIso) { where.push("a.created_at < ?"); params.push(toIso); }
    if (q.actorId) { where.push("a.actor_id = ?"); params.push(q.actorId); }
    if (q.entityType) { where.push("a.entity_type = ?"); params.push(q.entityType); }
    if (q.entityId) { where.push("a.entity_id = ?"); params.push(q.entityId); }
    if (q.q) {
      // Action code, record id, request id, actor name / e-mail, or an order number of the changed order.
      const like = likeOf(q.q);
      const m = "LIKE ? ESCAPE '\\'";
      where.push(`(lower(a.action) ${m} OR lower(a.entity_id) ${m} OR lower(a.request_id) ${m}
        OR a.actor_id IN (SELECT id FROM users WHERE lower(display_name) ${m} OR email_normalized ${m})
        OR (a.entity_type = 'order' AND a.entity_id IN (SELECT id FROM orders WHERE lower(order_number) ${m})))`);
      params.push(like, like, like, like, like, like);
    }
    const filtered = `SELECT a.*, ${AREA_SQL} AS area FROM audit_logs a${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
    const areaWhere = q.area === "all" ? "" : "WHERE f.area = ?";
    const areaParams = q.area === "all" ? [] : [q.area];
    const dir = q.dir === "asc" ? "ASC" : "DESC";

    const [page, total, counts] = await this.db.batch([
      this.db.statement(
        `${enrich(`SELECT f.* FROM (${filtered}) f ${areaWhere} ORDER BY f.created_at ${dir}, f.id ${dir} LIMIT ? OFFSET ?`)} ORDER BY a.created_at ${dir}, a.id ${dir}`,
        ...params, ...areaParams, q.pageSize, (q.page - 1) * q.pageSize,
      ),
      this.db.statement(`SELECT COUNT(*) AS n FROM (${filtered}) f ${areaWhere}`, ...params, ...areaParams),
      this.db.statement(`SELECT f.area, COUNT(*) AS n FROM (${filtered}) f GROUP BY f.area`, ...params),
    ]);
    const byArea = Object.fromEntries(((counts?.results ?? []) as { area: string; n: number }[]).map((r) => [r.area, Number(r.n)]));
    return {
      rows: ((page?.results ?? []) as Raw[]).map(summaryOf),
      total: Number(((total?.results ?? [])[0] as { n?: number } | undefined)?.n ?? 0),
      areaCounts: Object.fromEntries(AREAS.map((a) => [a, a === "all" ? Object.values(byArea).reduce((s, n) => s + n, 0) : byArea[a] ?? 0])) as Record<AuditArea, number>,
    };
  }

  async find(id: string): Promise<AuditEntryDetail | null> {
    const row = await this.db.first<Raw & { diff_redacted_json: string | null; ip_hash: string | null }>(
      `SELECT e.*, x.diff_redacted_json, x.ip_hash FROM (${enrich("SELECT * FROM audit_logs WHERE id = ?")}) e JOIN audit_logs x ON x.id = e.id`, id,
    );
    if (!row) return null;
    const [sameRequest, history] = await this.db.batch([
      this.db.statement(
        `${enrich("SELECT * FROM audit_logs WHERE request_id = ? AND id <> ? ORDER BY created_at, id LIMIT 50")} ORDER BY a.created_at, a.id`,
        row.request_id, id,
      ),
      // ix_audit_entity (entity_type, entity_id, created_at)
      this.db.statement(
        `${enrich("SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? AND id <> ? ORDER BY created_at DESC, id DESC LIMIT 20")} ORDER BY a.created_at DESC, a.id DESC`,
        row.entity_type, row.entity_id, id,
      ),
    ]);
    let diff: unknown = null;
    if (row.diff_redacted_json) {
      try { diff = redactDiff(JSON.parse(row.diff_redacted_json)); } catch { diff = null; }
    }
    return {
      ...summaryOf(row),
      diff,
      hasIp: !!row.ip_hash,
      sameRequest: row.request_id ? ((sameRequest?.results ?? []) as Raw[]).map(summaryOf) : [],
      entityHistory: row.entity_id ? ((history?.results ?? []) as Raw[]).map(summaryOf) : [],
    };
  }

  async filterOptions(): Promise<AuditFilterOptions> {
    const [actors, types] = await this.db.batch([
      this.db.statement(
        `SELECT u.id, u.display_name, u.email_normalized FROM users u
          WHERE u.id IN (SELECT DISTINCT actor_id FROM audit_logs WHERE actor_id IS NOT NULL) ORDER BY u.display_name COLLATE NOCASE LIMIT 200`,
      ),
      this.db.statement("SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type"),
    ]);
    return {
      actors: ((actors?.results ?? []) as { id: string; display_name: string; email_normalized: string }[]).map((u) => ({ id: u.id, name: u.display_name, email: u.email_normalized })),
      entityTypes: ((types?.results ?? []) as { entity_type: string }[])
        .map((t) => ({ value: t.entity_type, label: ENTITY_LABELS[t.entity_type] ?? t.entity_type }))
        .sort((a, b) => a.label.localeCompare(b.label, "tr")),
    };
  }
}
