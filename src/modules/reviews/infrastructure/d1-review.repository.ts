import { Repository, bit, bool, placeholders, type Statement } from "@/core";
import type { AdminReviewQuery, OwnReview, ReviewRepository, ReviewWrite } from "../application/ports";
import {
  ANONYMOUS_NAME, MODERATION_ACTIONS, emptySummary, maskName,
  type AdminReviewSort, type ContactChannel, type ContactDelivery, type ContactStatus, type ModerationAction, type ModerationMode, type MyReview, type PublicReview,
  type PublicReviewSort, type RatingSummary, type RejectReason, type ReviewableProduct, type ReviewDetail, type ReviewSettings, type ReviewStats, type ReviewStatus,
  type ReviewSummaryRow,
} from "../domain/review";

/** Order statuses that prove a purchase (paid and not cancelled / fully refunded). */
const PURCHASED = "('paid','preparing','shipped','delivered','completed','partially_refunded')";
const IMAGE = (product: string) => `(SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
   WHERE pm.product_id = ${product} ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1)`;
const VARIANT_LABEL = `(SELECT group_concat(d.label || ': ' || ao.label, ', ') FROM variant_options vo
   JOIN attribute_definitions d ON d.id = vo.attribute_id JOIN attribute_options ao ON ao.id = vo.option_id WHERE vo.variant_id = r.variant_id)`;
const CUSTOMER_NAME = "COALESCE(NULLIF(trim(COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')), ''), u.display_name)";

const PUBLIC_SORTS: Record<PublicReviewSort, string> = {
  newest: "published DESC, r.id",
  helpful: "r.helpful_count DESC, published DESC, r.id",
  rating_desc: "r.rating DESC, published DESC, r.id",
  rating_asc: "r.rating ASC, published DESC, r.id",
};
const ADMIN_SORTS: Record<AdminReviewSort, string> = {
  created_at: "r.created_at", rating: "r.rating", helpful_count: "r.helpful_count", product_name: "p.name COLLATE NOCASE",
};

type SummaryRaw = {
  id: string; status: ReviewStatus; rating: number; title: string | null; body: string; product_id: string; product_name: string; product_slug: string;
  product_image: string | null; customer_name: string; is_anonymous: number; verified_purchase: number; helpful_count: number; has_reply: number;
  contact_status: ContactStatus; created_at: string;
};
const ADMIN_SELECT = `
  SELECT r.id, r.status, r.rating, r.title, r.body, r.product_id, p.name AS product_name, p.slug AS product_slug, ${IMAGE("p.id")} AS product_image,
         ${CUSTOMER_NAME} AS customer_name, r.is_anonymous, r.verified_purchase, r.helpful_count, r.reply_body IS NOT NULL AS has_reply,
         r.contact_status, r.created_at
    FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id
    LEFT JOIN customer_profiles cp ON cp.user_id = r.user_id`;
const toSummaryRow = (r: SummaryRaw): ReviewSummaryRow => ({
  id: r.id, status: r.status, rating: r.rating, title: r.title, body: r.body, productId: r.product_id, productName: r.product_name, productSlug: r.product_slug,
  productImageUrl: r.product_image, customerName: r.customer_name, isAnonymous: bool(r.is_anonymous), verifiedPurchase: bool(r.verified_purchase),
  helpfulCount: r.helpful_count, hasReply: bool(r.has_reply), contactStatus: r.contact_status, createdAt: r.created_at,
});

export class D1ReviewRepository extends Repository implements ReviewRepository {
  // --- shop -----------------------------------------------------------------------------------------
  async publishedProduct(by: { slug: string } | { id: string }) {
    const [col, v] = "slug" in by ? ["slug", by.slug] : ["id", by.id];
    return this.db.first<{ id: string; name: string; slug: string }>(`SELECT id, name, slug FROM products WHERE ${col} = ? AND status = 'published'`, v);
  }

  async summary(productId: string): Promise<RatingSummary> {
    const rows = await this.db.all<{ rating: number; n: number }>(
      "SELECT rating, COUNT(*) AS n FROM reviews WHERE product_id = ? AND status = 'approved' GROUP BY rating", productId,
    );
    const s = emptySummary();
    let sum = 0;
    for (const r of rows) {
      s.distribution[r.rating - 1] = r.n;
      s.count += r.n;
      sum += r.rating * r.n;
    }
    s.average = s.count ? Math.round((sum / s.count) * 10) / 10 : null;
    return s;
  }

  async publicPage(productId: string, q: { sort: PublicReviewSort; rating?: number; page: number; pageSize: number }) {
    const ratingSql = q.rating ? " AND r.rating = ?" : "";
    const params = q.rating ? [productId, q.rating] : [productId];
    const [rows, total] = await Promise.all([
      this.db.all<{
        id: string; rating: number; title: string | null; body: string; is_anonymous: number; verified_purchase: number; helpful_count: number;
        published: string; reply_body: string | null; replied_at: string | null; first_name: string | null; last_name: string | null; display_name: string; variant_label: string | null;
      }>(
        `SELECT r.id, r.rating, r.title, r.body, r.is_anonymous, r.verified_purchase, r.helpful_count, COALESCE(r.published_at, r.created_at) AS published,
                r.reply_body, r.replied_at, cp.first_name, cp.last_name, u.display_name, ${VARIANT_LABEL} AS variant_label
           FROM reviews r JOIN users u ON u.id = r.user_id LEFT JOIN customer_profiles cp ON cp.user_id = r.user_id
          WHERE r.product_id = ? AND r.status = 'approved'${ratingSql}
          ORDER BY ${PUBLIC_SORTS[q.sort]} LIMIT ? OFFSET ?`,
        ...params, q.pageSize, (q.page - 1) * q.pageSize,
      ),
      this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM reviews r WHERE r.product_id = ? AND r.status = 'approved'${ratingSql}`, ...params),
    ]);
    const items: PublicReview[] = rows.map((r) => ({
      id: r.id, rating: r.rating, title: r.title, body: r.body,
      authorName: bool(r.is_anonymous) ? ANONYMOUS_NAME : maskName(r.first_name, r.last_name, r.display_name),
      verifiedPurchase: bool(r.verified_purchase), variantLabel: r.variant_label, helpfulCount: r.helpful_count, publishedAt: r.published,
      reply: r.reply_body && r.replied_at ? { body: r.reply_body, repliedAt: r.replied_at } : null,
    }));
    return { items, total: total?.n ?? 0 };
  }

  async purchase(userId: string, productId: string) {
    const r = await this.db.first<{ order_item_id: string; variant_id: string }>(
      `SELECT oi.id AS order_item_id, oi.variant_id FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN product_variants v ON v.id = oi.variant_id
        WHERE o.user_id = ? AND v.product_id = ? AND o.status IN ${PURCHASED} ORDER BY o.placed_at DESC LIMIT 1`,
      userId, productId,
    );
    return r ? { orderItemId: r.order_item_id, variantId: r.variant_id } : null;
  }

  async own(userId: string, productId: string): Promise<OwnReview | null> {
    const r = await this.db.first<{ id: string; version: number; status: ReviewStatus; rating: number; title: string | null; body: string; is_anonymous: number; reject_reason: RejectReason | null }>(
      "SELECT id, version, status, rating, title, body, is_anonymous, reject_reason FROM reviews WHERE user_id = ? AND product_id = ?", userId, productId,
    );
    return r ? { id: r.id, version: r.version, status: r.status, rating: r.rating, title: r.title, body: r.body, isAnonymous: bool(r.is_anonymous), rejectReason: r.reject_reason } : null;
  }

  async customerName(userId: string) {
    const r = await this.db.first<{ first_name: string | null; last_name: string | null; display_name: string; email: string }>(
      "SELECT cp.first_name, cp.last_name, u.display_name, u.email_normalized AS email FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.id = ?", userId,
    );
    return r ? { first: r.first_name, last: r.last_name, display: r.display_name, email: r.email } : null;
  }

  insertStatement(id: string, productId: string, userId: string, w: ReviewWrite, now: string): Statement {
    return this.db.statement(
      `INSERT INTO reviews (id, product_id, user_id, order_item_id, variant_id, rating, title, body, status, is_anonymous, verified_purchase, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, productId, userId, w.orderItemId, w.variantId, w.rating, w.title, w.body, w.status, bit(w.isAnonymous), bit(w.verifiedPurchase),
      w.status === "approved" ? now : null, now, now,
    );
  }

  updateOwnStatement(id: string, expectedVersion: number, w: ReviewWrite, now: string): Statement {
    // An edit is a new text: moderation starts over (reason / note cleared); the store reply stays.
    return this.db.statement(
      `UPDATE reviews SET rating = ?, title = ?, body = ?, is_anonymous = ?, verified_purchase = ?, order_item_id = COALESCE(?, order_item_id),
              variant_id = COALESCE(?, variant_id), status = ?, reject_reason = NULL, moderation_note = NULL, moderated_by = NULL, moderated_at = NULL,
              published_at = CASE WHEN ? = 'approved' THEN ? ELSE NULL END, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      w.rating, w.title, w.body, bit(w.isAnonymous), bit(w.verifiedPurchase), w.orderItemId, w.variantId, w.status, w.status, now, now, id, expectedVersion,
    );
  }

  async voteTarget(reviewId: string) {
    const r = await this.db.first<{ user_id: string; status: ReviewStatus }>("SELECT user_id, status FROM reviews WHERE id = ?", reviewId);
    return r ? { userId: r.user_id, status: r.status } : null;
  }

  voteStatements(reviewId: string, userId: string, helpful: boolean): Statement[] {
    return [
      helpful
        ? this.db.statement(
          `INSERT OR IGNORE INTO review_votes (review_id, user_id)
             SELECT ?, ? WHERE EXISTS (SELECT 1 FROM reviews WHERE id = ? AND status = 'approved' AND user_id <> ?)`, reviewId, userId, reviewId, userId)
        : this.db.statement("DELETE FROM review_votes WHERE review_id = ? AND user_id = ?", reviewId, userId),
      this.db.statement("UPDATE reviews SET helpful_count = (SELECT COUNT(*) FROM review_votes WHERE review_id = ?) WHERE id = ?", reviewId, reviewId),
    ];
  }

  async helpfulCount(reviewId: string): Promise<number> {
    return (await this.db.first<{ n: number }>("SELECT helpful_count AS n FROM reviews WHERE id = ?", reviewId))?.n ?? 0;
  }

  async myReviews(userId: string): Promise<MyReview[]> {
    const [rows, messages] = await Promise.all([
      this.db.all<{
        id: string; name: string; slug: string; image: string | null; rating: number; title: string | null; body: string; status: ReviewStatus;
        reject_reason: RejectReason | null; created_at: string; reply_body: string | null; replied_at: string | null;
      }>(
        `SELECT r.id, p.name, p.slug, ${IMAGE("p.id")} AS image, r.rating, r.title, r.body, r.status, r.reject_reason, r.created_at, r.reply_body, r.replied_at
           FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 100`, userId,
      ),
      this.db.all<{ review_id: string; subject: string | null; body: string; created_at: string }>(
        `SELECT c.review_id, c.subject, c.body, c.created_at FROM review_contacts c JOIN reviews r ON r.id = c.review_id
          WHERE r.user_id = ? AND c.visible_to_customer = 1 AND c.delivery = 'sent' ORDER BY c.created_at`, userId,
      ),
    ]);
    return rows.map((r) => ({
      id: r.id, product: { name: r.name, slug: r.slug, imageUrl: r.image }, rating: r.rating, title: r.title, body: r.body, status: r.status,
      rejectReason: r.reject_reason, createdAt: r.created_at,
      reply: r.reply_body && r.replied_at && r.status === "approved" ? { body: r.reply_body, repliedAt: r.replied_at } : null,
      messages: messages.filter((m) => m.review_id === r.id).map((m) => ({ subject: m.subject, body: m.body, createdAt: m.created_at })),
    }));
  }

  async reviewable(userId: string, limit: number): Promise<ReviewableProduct[]> {
    const rows = await this.db.all<{ id: string; name: string; slug: string; image: string | null; ordered_at: string }>(
      `SELECT p.id, p.name, p.slug, ${IMAGE("p.id")} AS image, MAX(o.placed_at) AS ordered_at
         FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN product_variants v ON v.id = oi.variant_id JOIN products p ON p.id = v.product_id
        WHERE o.user_id = ? AND o.status IN ${PURCHASED} AND p.status = 'published'
          AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.product_id = p.id AND r.user_id = o.user_id)
        GROUP BY p.id ORDER BY ordered_at DESC LIMIT ?`, userId, limit,
    );
    return rows.map((r) => ({ productId: r.id, name: r.name, slug: r.slug, imageUrl: r.image, orderedAt: r.ordered_at }));
  }

  // --- settings -------------------------------------------------------------------------------------
  async settings(): Promise<ReviewSettings> {
    const r = await this.db.first<{ moderation_mode: ModerationMode; require_purchase: number; allow_anonymous: number; min_body_length: number; blocked_words: string; updated_at: string }>(
      "SELECT moderation_mode, require_purchase, allow_anonymous, min_body_length, blocked_words, updated_at FROM review_settings WHERE id = 1",
    );
    if (!r) return { moderationMode: "manual", requirePurchase: true, allowAnonymous: true, minBodyLength: 10, blockedWords: [], updatedAt: "" };
    let words: unknown = [];
    try { words = JSON.parse(r.blocked_words); } catch { /* json_valid CHECK */ }
    return {
      moderationMode: r.moderation_mode, requirePurchase: bool(r.require_purchase), allowAnonymous: bool(r.allow_anonymous), minBodyLength: r.min_body_length,
      blockedWords: Array.isArray(words) ? words.filter((w): w is string => typeof w === "string") : [], updatedAt: r.updated_at,
    };
  }

  updateSettingsStatement(s: Omit<ReviewSettings, "updatedAt">, expectedUpdatedAt: string, actorId: string, now: string): Statement {
    return this.db.statement(
      `UPDATE review_settings SET moderation_mode = ?, require_purchase = ?, allow_anonymous = ?, min_body_length = ?, blocked_words = ?, updated_by = ?, updated_at = ?
        WHERE id = 1 AND updated_at = ?`,
      s.moderationMode, bit(s.requirePurchase), bit(s.allowAnonymous), s.minBodyLength, JSON.stringify(s.blockedWords), actorId, now, expectedUpdatedAt,
    );
  }

  // --- panel ----------------------------------------------------------------------------------------
  async list(q: AdminReviewQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.tab !== "all") { where.push("r.status = ?"); params.push(q.tab); }
    if (q.rating) { where.push("r.rating = ?"); params.push(q.rating); }
    if (q.productId) { where.push("r.product_id = ?"); params.push(q.productId); }
    if (q.q) {
      where.push(`(instr(lower(p.name), lower(?)) > 0 OR instr(lower(r.body), lower(?)) > 0 OR instr(lower(COALESCE(r.title, '')), lower(?)) > 0
                   OR instr(lower(${CUSTOMER_NAME}), lower(?)) > 0 OR instr(u.email_normalized, lower(?)) > 0)`);
      params.push(q.q, q.q, q.q, q.q, q.q);
    }
    const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const [rows, total] = await Promise.all([
      this.db.all<SummaryRaw>(`${ADMIN_SELECT}${whereSql} ORDER BY ${ADMIN_SORTS[q.sort]} ${q.dir === "asc" ? "ASC" : "DESC"}, r.id LIMIT ? OFFSET ?`, ...params, q.pageSize, (q.page - 1) * q.pageSize),
      this.db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id LEFT JOIN customer_profiles cp ON cp.user_id = r.user_id${whereSql}`,
        ...params,
      ),
    ]);
    return { rows: rows.map(toSummaryRow), total: total?.n ?? 0 };
  }

  async stats(): Promise<ReviewStats> {
    const r = await this.db.first<{ pending: number | null; approved: number | null; rejected: number | null; hidden: number | null; total: number; average: number | null; low: number | null }>(
      `SELECT SUM(status = 'pending') AS pending, SUM(status = 'approved') AS approved, SUM(status = 'rejected') AS rejected, SUM(status = 'hidden') AS hidden,
              COUNT(*) AS total, ROUND(AVG(CASE WHEN status = 'approved' THEN rating END), 2) AS average, SUM(status = 'pending' AND rating <= 2) AS low
         FROM reviews`,
    );
    return {
      counts: { pending: r?.pending ?? 0, approved: r?.approved ?? 0, rejected: r?.rejected ?? 0, hidden: r?.hidden ?? 0, all: r?.total ?? 0 },
      average: r?.average ?? null, lowRatingPending: r?.low ?? 0,
    };
  }

  async detail(id: string): Promise<ReviewDetail | null> {
    const r = await this.db.first<SummaryRaw & {
      version: number; variant_label: string | null; reject_reason: RejectReason | null; moderation_note: string | null; moderated_at: string | null;
      moderated_by_name: string | null; published_at: string | null; updated_at: string; reply_body: string | null; replied_at: string | null; reply_by_name: string | null;
      user_id: string; email: string; phone: string | null; order_count: number; review_count: number;
    }>(
      `SELECT r.id, r.status, r.rating, r.title, r.body, r.product_id, p.name AS product_name, p.slug AS product_slug, ${IMAGE("p.id")} AS product_image,
              ${CUSTOMER_NAME} AS customer_name, r.is_anonymous, r.verified_purchase, r.helpful_count, r.reply_body IS NOT NULL AS has_reply,
              r.contact_status, r.created_at, r.version, ${VARIANT_LABEL} AS variant_label, r.reject_reason, r.moderation_note, r.moderated_at,
              mu.display_name AS moderated_by_name, r.published_at, r.updated_at, r.reply_body, r.replied_at, ru.display_name AS reply_by_name,
              r.user_id, u.email_normalized AS email, u.phone_e164 AS phone,
              (SELECT COUNT(*) FROM orders o WHERE o.user_id = r.user_id) AS order_count,
              (SELECT COUNT(*) FROM reviews r2 WHERE r2.user_id = r.user_id) AS review_count
         FROM reviews r JOIN products p ON p.id = r.product_id JOIN users u ON u.id = r.user_id
         LEFT JOIN customer_profiles cp ON cp.user_id = r.user_id
         LEFT JOIN users mu ON mu.id = r.moderated_by LEFT JOIN users ru ON ru.id = r.reply_by
        WHERE r.id = ?`, id,
    );
    if (!r) return null;
    const contacts = await this.db.all<{ id: string; channel: ContactChannel; subject: string | null; body: string; delivery: ContactDelivery; visible_to_customer: number; created_at: string; name: string | null }>(
      `SELECT c.id, c.channel, c.subject, c.body, c.delivery, c.visible_to_customer, c.created_at, u.display_name AS name
         FROM review_contacts c LEFT JOIN users u ON u.id = c.created_by WHERE c.review_id = ? ORDER BY c.created_at DESC LIMIT 100`, id,
    );
    return {
      ...toSummaryRow(r), version: r.version, variantLabel: r.variant_label, rejectReason: r.reject_reason, moderationNote: r.moderation_note,
      moderatedAt: r.moderated_at, moderatedByName: r.moderated_by_name, publishedAt: r.published_at, updatedAt: r.updated_at,
      reply: r.reply_body && r.replied_at ? { body: r.reply_body, repliedAt: r.replied_at, byName: r.reply_by_name } : null,
      customer: { id: r.user_id, name: r.customer_name, email: r.email, phone: r.phone, orderCount: r.order_count, reviewCount: r.review_count },
      contacts: contacts.map((c) => ({
        id: c.id, channel: c.channel, subject: c.subject, body: c.body, delivery: c.delivery, visibleToCustomer: bool(c.visible_to_customer), createdAt: c.created_at, createdByName: c.name,
      })),
    };
  }

  async statuses(ids: string[]) {
    return this.db.all<{ id: string; status: ReviewStatus; productName: string }>(
      `SELECT r.id, r.status, p.name AS productName FROM reviews r JOIN products p ON p.id = r.product_id WHERE r.id IN (${placeholders(ids.length)})`, ...ids,
    );
  }

  moderateStatement(ids: string[], action: ModerationAction, reason: RejectReason | null, note: string | null, actorId: string, now: string): Statement {
    const a = MODERATION_ACTIONS[action];
    return this.db.statement(
      `UPDATE reviews SET status = ?, reject_reason = ?, moderation_note = COALESCE(?, moderation_note), moderated_by = ?, moderated_at = ?,
              published_at = CASE WHEN ? = 'approved' THEN COALESCE(published_at, ?) ELSE published_at END, version = version + 1, updated_at = ?
        WHERE id IN (${placeholders(ids.length)}) AND status IN (${placeholders(a.from.length)})`,
      a.to, a.to === "rejected" ? reason : null, note, actorId, now, a.to, now, now, ...ids, ...a.from,
    );
  }

  replyStatement(id: string, body: string | null, actorId: string, now: string): Statement {
    return this.db.statement(
      "UPDATE reviews SET reply_body = ?, reply_by = ?, replied_at = ?, version = version + 1, updated_at = ? WHERE id = ?",
      body, body ? actorId : null, body ? now : null, now, id,
    );
  }

  contactStatusStatement(id: string, status: ContactStatus, now: string): Statement {
    return this.db.statement("UPDATE reviews SET contact_status = ?, updated_at = ? WHERE id = ?", status, now, id);
  }

  insertContactStatement(c: { id: string; reviewId: string; channel: ContactChannel; subject: string | null; body: string; delivery: ContactDelivery; visibleToCustomer: boolean; actorId: string; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO review_contacts (id, review_id, channel, subject, body, delivery, visible_to_customer, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.id, c.reviewId, c.channel, c.subject, c.body, c.delivery, bit(c.visibleToCustomer), c.actorId, c.now,
    );
  }

  setDeliveryStatement(contactId: string, delivery: ContactDelivery): Statement {
    return this.db.statement("UPDATE review_contacts SET delivery = ? WHERE id = ?", delivery, contactId);
  }
}
