import { Repository, bool, type Statement } from "@/core";
import { ANONYMOUS_NAME, maskName } from "@/modules/reviews";
import type { AdminQuestionQuery, QuestionRepository } from "../application/ports";
import { QUESTION_TABS, type AdminQuestionRow, type OwnQuestion, type PublicQuestion, type QuestionCounts, type QuestionStatus, type QuestionTab } from "../domain/question";

const IMAGE = `(SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id AND m.mime_type LIKE 'image/%'
   WHERE pm.product_id = p.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1)`;
const CUSTOMER_NAME = "COALESCE(NULLIF(trim(COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')), ''), u.display_name)";
const SORT_SQL = { created_at: "q.created_at", answered_at: "q.answered_at", product_name: "p.name COLLATE NOCASE" } as const;

type AdminRaw = {
  id: string; product_id: string; product_name: string; product_slug: string; product_image: string | null; body: string; customer_name: string; customer_email: string;
  is_anonymous: number; status: QuestionStatus; answer_body: string | null; answered_at: string | null; answered_by_name: string | null; reject_note: string | null;
  notified_at: string | null; created_at: string; updated_at: string;
};

const ADMIN_SELECT = `SELECT q.id, q.product_id, p.name AS product_name, p.slug AS product_slug, ${IMAGE} AS product_image, q.body, ${CUSTOMER_NAME} AS customer_name,
       u.email_normalized AS customer_email, q.is_anonymous, q.status, q.answer_body, q.answered_at, a.display_name AS answered_by_name, q.reject_note, q.notified_at,
       q.created_at, q.updated_at
  FROM product_questions q JOIN products p ON p.id = q.product_id JOIN users u ON u.id = q.user_id
  LEFT JOIN customer_profiles cp ON cp.user_id = q.user_id LEFT JOIN users a ON a.id = q.answered_by`;

const toAdmin = (r: AdminRaw): AdminQuestionRow => ({
  id: r.id, productId: r.product_id, productName: r.product_name, productSlug: r.product_slug, productImageUrl: r.product_image, body: r.body,
  customerName: r.customer_name, customerEmail: r.customer_email, isAnonymous: bool(r.is_anonymous), status: r.status, answerBody: r.answer_body,
  answeredAt: r.answered_at, answeredByName: r.answered_by_name, rejectNote: r.reject_note, notifiedAt: r.notified_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class D1QuestionRepository extends Repository implements QuestionRepository {
  publishedProduct(slug: string) {
    return this.db.first<{ id: string; name: string }>("SELECT id, name FROM products WHERE slug = ? AND status = 'published'", slug);
  }

  async publicPage(productId: string, page: number, pageSize: number): Promise<{ items: PublicQuestion[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db.all<{ id: string; body: string; is_anonymous: number; first_name: string | null; last_name: string | null; display_name: string; created_at: string; answer_body: string; answered_at: string }>(
        `SELECT q.id, q.body, q.is_anonymous, cp.first_name, cp.last_name, u.display_name, q.created_at, q.answer_body, q.answered_at
           FROM product_questions q JOIN users u ON u.id = q.user_id LEFT JOIN customer_profiles cp ON cp.user_id = q.user_id
          WHERE q.product_id = ? AND q.status = 'answered'
          ORDER BY q.answered_at DESC, q.id LIMIT ? OFFSET ?`,
        productId, pageSize, (page - 1) * pageSize,
      ),
      this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM product_questions WHERE product_id = ? AND status = 'answered'", productId),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id, body: r.body, authorName: bool(r.is_anonymous) ? ANONYMOUS_NAME : maskName(r.first_name, r.last_name, r.display_name),
        askedAt: r.created_at, answer: r.answer_body, answeredAt: r.answered_at,
      })),
      total: total?.n ?? 0,
    };
  }

  async own(userId: string, productId: string): Promise<OwnQuestion[]> {
    const rows = await this.db.all<{ id: string; body: string; status: "pending" | "rejected"; created_at: string }>(
      `SELECT id, body, status, created_at FROM product_questions WHERE user_id = ? AND product_id = ? AND status <> 'answered' ORDER BY created_at DESC LIMIT 10`,
      userId, productId,
    );
    return rows.map((r) => ({ id: r.id, body: r.body, status: r.status, createdAt: r.created_at }));
  }

  async openBodies(userId: string, productId: string): Promise<string[]> {
    return (await this.db.all<{ body: string }>("SELECT body FROM product_questions WHERE user_id = ? AND product_id = ? AND status = 'pending'", userId, productId)).map((r) => r.body);
  }

  insertStatement(q: { id: string; productId: string; userId: string; body: string; isAnonymous: boolean; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO product_questions (id, product_id, user_id, body, is_anonymous, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
      q.id, q.productId, q.userId, q.body, q.isAnonymous ? 1 : 0, q.now, q.now,
    );
  }

  async list(q: AdminQuestionQuery): Promise<{ rows: AdminQuestionRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.tab !== "all") { where.push("q.status = ?"); params.push(q.tab); }
    if (q.productId) { where.push("q.product_id = ?"); params.push(q.productId); }
    if (q.q) {
      where.push(`(instr(lower(p.name), lower(?)) > 0 OR instr(lower(q.body), lower(?)) > 0 OR instr(lower(COALESCE(q.answer_body, '')), lower(?)) > 0
                   OR instr(lower(${CUSTOMER_NAME}), lower(?)) > 0 OR instr(u.email_normalized, lower(?)) > 0)`);
      params.push(q.q, q.q, q.q, q.q, q.q);
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows, total] = await Promise.all([
      this.db.all<AdminRaw>(`${ADMIN_SELECT} ${w} ORDER BY ${SORT_SQL[q.sort]} ${q.dir === "asc" ? "ASC" : "DESC"}, q.id LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize),
      this.db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM product_questions q JOIN products p ON p.id = q.product_id JOIN users u ON u.id = q.user_id LEFT JOIN customer_profiles cp ON cp.user_id = q.user_id ${w}`,
        ...params,
      ),
    ]);
    return { rows: rows.map(toAdmin), total: total?.n ?? 0 };
  }

  async counts(): Promise<QuestionCounts> {
    const rows = await this.db.all<{ status: QuestionStatus; n: number }>("SELECT status, COUNT(*) AS n FROM product_questions GROUP BY status");
    const out = Object.fromEntries(Object.keys(QUESTION_TABS).map((k) => [k, 0])) as QuestionCounts;
    for (const r of rows) { out[r.status as QuestionTab] = r.n; out.all += r.n; }
    return out;
  }

  async get(id: string): Promise<AdminQuestionRow | null> {
    const r = await this.db.first<AdminRaw>(`${ADMIN_SELECT} WHERE q.id = ?`, id);
    return r ? toAdmin(r) : null;
  }

  answerStatement(id: string, answer: string, actorId: string, expectedUpdatedAt: string, now: string): Statement {
    return this.db.statement(
      `UPDATE product_questions SET status = 'answered', answer_body = ?, answered_by = ?, answered_at = COALESCE(answered_at, ?), reject_note = NULL, updated_at = ?
        WHERE id = ? AND updated_at = ?`,
      answer, actorId, now, now, id, expectedUpdatedAt,
    );
  }

  rejectStatement(id: string, note: string | null, expectedUpdatedAt: string, now: string): Statement {
    return this.db.statement(
      "UPDATE product_questions SET status = 'rejected', reject_note = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND status <> 'rejected'",
      note, now, id, expectedUpdatedAt,
    );
  }

  markNotifiedStatement(id: string, now: string): Statement {
    return this.db.statement("UPDATE product_questions SET notified_at = ? WHERE id = ? AND notified_at IS NULL", now, id);
  }
}
