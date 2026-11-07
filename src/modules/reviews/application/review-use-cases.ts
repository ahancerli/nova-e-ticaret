import { UnitOfWork, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import { emailLayout, escapeHtml, type MailSender } from "@/modules/mail";
import type { NotificationPublisher } from "@/modules/notifications";
import type { Actor } from "@/modules/shared/actor";
import { ReviewErrors } from "../domain/errors";
import {
  BULK_MAX, CONTACT_STATUSES, MODERATION_ACTIONS, REVIEW_PAGE_SIZE, canModerate, cleanText, emptySummary, publishesImmediately,
  type ContactChannel, type ContactDelivery, type ContactStatus, type ModerationAction, type ModerationMode, type MyReview, type PublicReviewSort,
  type RejectReason, type ReviewableProduct, type ReviewDetail, type ReviewEligibility, type ReviewInput, type ReviewPage, type ReviewSettings,
} from "../domain/review";
import type { AdminReviewQuery, ReviewRepository, ReviewWrite } from "./ports";

export interface ReviewDeps {
  db: Database;
  reviews: ReviewRepository;
  notifications: NotificationPublisher;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const textOrNull = (v: string | null | undefined) => (v ? cleanText(v) || null : null);

// --- shop -------------------------------------------------------------------------------------------

/** Query: rating summary + one page of published reviews (shop product page, GraphQL `reviews`). */
export class GetProductReviews {
  constructor(private readonly reviews: ReviewRepository) {}

  async execute(productId: string, q: { sort?: PublicReviewSort; rating?: number | null; page?: number }): Promise<ReviewPage> {
    const page = Math.max(1, Math.min(q.page ?? 1, 1000));
    const rating = q.rating && q.rating >= 1 && q.rating <= 5 ? q.rating : undefined;
    const [summary, { items, total }] = await Promise.all([
      this.reviews.summary(productId),
      this.reviews.publicPage(productId, { sort: q.sort ?? "newest", rating, page, pageSize: REVIEW_PAGE_SIZE }),
    ]);
    return { summary: summary ?? emptySummary(), items, total, page, pages: Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE)) };
  }
}

/** Query: may this visitor review the product, and their current review (form pre-fill). */
export class GetReviewEligibility {
  constructor(private readonly reviews: ReviewRepository) {}

  async execute(productSlug: string, userId: string | null): Promise<ReviewEligibility> {
    const product = await this.reviews.publishedProduct({ slug: productSlug });
    if (!product) throw ReviewErrors.productNotFound();
    const settings = await this.reviews.settings();
    const base = { allowAnonymous: settings.allowAnonymous, minBodyLength: settings.minBodyLength };
    if (!userId) return { ...base, signedIn: false, canReview: false, reason: "sign_in", verifiedPurchase: false, existing: null };
    const [purchase, own] = await Promise.all([this.reviews.purchase(userId, product.id), this.reviews.own(userId, product.id)]);
    const canReview = !settings.requirePurchase || purchase !== null;
    return {
      ...base, signedIn: true, canReview, reason: canReview ? null : "purchase_required", verifiedPurchase: purchase !== null,
      existing: own ? { rating: own.rating, title: own.title, body: own.body, isAnonymous: own.isAnonymous, status: own.status, rejectReason: own.rejectReason } : null,
    };
  }
}

/**
 * Command: a customer writes (or edits) their review of a product. One review per customer and product; an edit
 * starts moderation again. Unless the trusted auto-publish rule applies, the review waits for staff and a panel
 * notification is raised in the same transaction (1–2 stars also raise "Düşük puanlı yorum").
 */
export class SubmitReview {
  constructor(private readonly deps: ReviewDeps) {}

  async execute(productSlug: string, input: ReviewInput, actor: Actor): Promise<{ id: string; status: "pending" | "approved"; unchanged: boolean }> {
    const { reviews } = this.deps;
    const product = await reviews.publishedProduct({ slug: productSlug });
    if (!product) throw ReviewErrors.productNotFound();
    const [settings, purchase, existing] = await Promise.all([reviews.settings(), reviews.purchase(actor.userId, product.id), reviews.own(actor.userId, product.id)]);
    if (settings.requirePurchase && !purchase) throw ReviewErrors.purchaseRequired();
    const isAnonymous = input.isAnonymous ?? false;
    if (isAnonymous && !settings.allowAnonymous) throw ReviewErrors.anonymousNotAllowed();
    const title = textOrNull(input.title);
    const body = cleanText(input.body);
    if (body.length < settings.minBodyLength) throw ReviewErrors.bodyTooShort(settings.minBodyLength);

    if (existing && existing.rating === input.rating && existing.title === title && existing.body === body && existing.isAnonymous === isAnonymous && existing.status !== "rejected") {
      return { id: existing.id, status: existing.status === "approved" ? "approved" : "pending", unchanged: true };
    }

    const live = publishesImmediately(settings, { rating: input.rating, verifiedPurchase: purchase !== null, text: `${title ?? ""} ${body}` });
    const w: ReviewWrite = {
      rating: input.rating, title, body, isAnonymous, verifiedPurchase: purchase !== null, orderItemId: purchase?.orderItemId ?? null,
      variantId: purchase?.variantId ?? null, status: live ? "approved" : "pending",
    };
    const now = this.deps.clock.nowIso();
    const id = existing?.id ?? this.deps.ids.newId();
    const version = existing ? existing.version + 1 : 1;
    const uow = new UnitOfWork(this.deps.db);
    if (existing) uow.add(reviews.updateOwnStatement(id, existing.version, w, now)).expectChanges(1, ReviewErrors.changedMeanwhile);
    else uow.add(reviews.insertStatement(id, product.id, actor.userId, w, now));

    if (!live) {
      const summary = `${product.name} · ${"★".repeat(input.rating)}${"☆".repeat(5 - input.rating)}${title ? ` · “${title}”` : ""}`;
      const href = `/admin/yorumlar?yorum=${id}`;
      uow.add(...await this.deps.notifications.statements({
        type: "review.pending", title: existing ? "Düzenlenen yorum onay bekliyor" : "Yeni ürün yorumu onay bekliyor", body: summary, href,
        entityType: "review", entityId: id, dedupeKey: `review.pending:${id}:v${version}`,
      }));
      if (input.rating <= 2) {
        uow.add(...await this.deps.notifications.statements({
          type: "review.low_rating", title: `${input.rating} yıldızlı yorum geldi`, body: `${summary} — müşteriyle iletişime geçmeyi düşünün.`, href,
          entityType: "review", entityId: id, dedupeKey: `review.low_rating:${id}:v${version}`,
        }));
      }
    }
    await uow.commit();
    return { id, status: w.status, unchanged: false };
  }
}

/** Command: "Faydalı buldum" on / off — signed-in customers, published reviews of others only. */
export class VoteReview {
  constructor(private readonly db: Database, private readonly reviews: ReviewRepository) {}

  async execute(reviewId: string, helpful: boolean, actor: Actor): Promise<{ helpfulCount: number; voted: boolean }> {
    const target = await this.reviews.voteTarget(reviewId);
    if (!target || target.status !== "approved") throw ReviewErrors.voteUnavailable();
    if (target.userId === actor.userId) throw ReviewErrors.voteOwn();
    await this.db.batch(this.reviews.voteStatements(reviewId, actor.userId, helpful));
    return { helpfulCount: await this.reviews.helpfulCount(reviewId), voted: helpful };
  }
}

/** Query: Hesabım › Değerlendirmelerim — own reviews with status, store reply and messages, plus products to review. */
export class ListMyReviews {
  constructor(private readonly reviews: ReviewRepository) {}

  async execute(userId: string): Promise<{ reviews: MyReview[]; reviewable: ReviewableProduct[] }> {
    const [reviews, reviewable] = await Promise.all([this.reviews.myReviews(userId), this.reviews.reviewable(userId, 12)]);
    return { reviews, reviewable };
  }
}

// --- panel ------------------------------------------------------------------------------------------

export class ListReviews {
  constructor(private readonly reviews: ReviewRepository) {}

  async execute(q: AdminReviewQuery) {
    const [page, stats] = await Promise.all([this.reviews.list(q), this.reviews.stats()]);
    return { ...page, stats };
  }
}

export class GetReview {
  constructor(private readonly reviews: ReviewRepository) {}

  /** Contact details are blanked for staff without `customers.read` (e-mail still goes out through ContactReviewer). */
  async execute(id: string, canSeeContact: boolean): Promise<ReviewDetail | null> {
    const d = await this.reviews.detail(id);
    if (!d || canSeeContact) return d;
    return { ...d, customer: { ...d.customer, email: null, phone: null } };
  }
}

/**
 * Command: publish / reject / take down one or many reviews (bulk ≤ 50). Reviews whose current status does not
 * allow the action are skipped; the rest change in one transaction, guarded against concurrent moderation. Their
 * "onay bekliyor" notifications are dismissed for everyone.
 */
export class ModerateReviews {
  constructor(private readonly deps: ReviewDeps) {}

  async execute(input: { ids: string[]; action: ModerationAction; reason?: RejectReason | null; note?: string | null }, actor: Actor): Promise<{ changed: number; skipped: number }> {
    const ids = [...new Set(input.ids)].slice(0, BULK_MAX);
    const reason = input.action === "reject" ? input.reason ?? null : null;
    if (input.action === "reject" && !reason) throw ReviewErrors.reasonRequired();
    const rows = await this.deps.reviews.statuses(ids);
    if (!rows.length) throw ReviewErrors.notFound();
    const allowed = rows.filter((r) => canModerate(input.action, r.status));
    if (!allowed.length) throw ReviewErrors.notAllowed(MODERATION_ACTIONS[input.action].label);

    const now = this.deps.clock.nowIso();
    const note = textOrNull(input.note);
    const allowedIds = allowed.map((r) => r.id);
    const to = MODERATION_ACTIONS[input.action].to;
    const uow = new UnitOfWork(this.deps.db)
      .add(this.deps.reviews.moderateStatement(allowedIds, input.action, reason, note, actor.userId, now))
      .expectChanges(allowedIds.length, ReviewErrors.changedMeanwhile)
      .add(this.deps.notifications.dismissStatement("review.pending", "review", allowedIds));
    for (const r of allowed) {
      uow.add(this.deps.audit.recordStatement({
        actor, action: `review.${input.action}`, entityType: "review", entityId: r.id,
        diff: { product: r.productName, from: r.status, to, ...(reason ? { reason } : {}), ...(note ? { note } : {}), ...(ids.length > 1 ? { bulk: ids.length } : {}) },
      }));
    }
    await uow.commit();
    return { changed: allowed.length, skipped: ids.length - allowed.length };
  }
}

/** Command: public store reply under the review (shown in the shop once the review is published). `null` removes it. */
export class ReplyToReview {
  constructor(private readonly deps: ReviewDeps) {}

  async execute(id: string, body: string | null, actor: Actor): Promise<{ replied: boolean }> {
    const d = await this.deps.reviews.detail(id);
    if (!d) throw ReviewErrors.notFound();
    const text = textOrNull(body);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.reviews.replyStatement(id, text, actor.userId, this.deps.clock.nowIso()))
      .add(this.deps.audit.recordStatement({ actor, action: text ? "review.reply" : "review.reply_delete", entityType: "review", entityId: id, diff: { product: d.productName } }))
      .commit();
    return { replied: text !== null };
  }
}

export interface ContactInput {
  channel: ContactChannel;
  subject?: string | null;
  body: string;
  contactStatus?: ContactStatus;
}

/**
 * Command: staff contacts the reviewer. E-mail goes to the customer's address (staff never needs to see it) and is
 * listed under Hesabım; phone calls and notes are logged for staff only. The log row commits first; the mail is sent
 * after the commit and its outcome recorded on the row.
 */
export class ContactReviewer {
  constructor(
    private readonly deps: ReviewDeps, private readonly mail: MailSender, private readonly brand: () => Promise<string>, private readonly siteUrl: string,
    private readonly logger: Logger,
  ) {}

  async execute(id: string, input: ContactInput, actor: Actor): Promise<{ contactId: string; delivery: ContactDelivery; contactStatus: ContactStatus }> {
    const d = await this.deps.reviews.detail(id);
    if (!d) throw ReviewErrors.notFound();
    if (input.channel === "email" && !d.customer.email) throw ReviewErrors.noEmail();
    const subject = input.channel === "email" ? textOrNull(input.subject) ?? `“${d.productName}” değerlendirmeniz hakkında` : null;
    const body = cleanText(input.body);
    const contactStatus = input.contactStatus ?? (d.contactStatus === "none" ? "contacted" : d.contactStatus);
    const contactId = this.deps.ids.newId();
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.reviews.insertContactStatement({ id: contactId, reviewId: id, channel: input.channel, subject, body, delivery: "logged", visibleToCustomer: input.channel === "email", actorId: actor.userId, now }))
      .add(this.deps.reviews.contactStatusStatement(id, contactStatus, now))
      .add(this.deps.audit.recordStatement({ actor, action: "review.contact", entityType: "review", entityId: id, diff: { channel: input.channel, contactStatus: CONTACT_STATUSES[contactStatus] } }))
      .commit();
    if (input.channel !== "email") return { contactId, delivery: "logged", contactStatus };

    let delivery: ContactDelivery;
    try {
      const brand = await this.brand();
      const firstName = d.customer.name.split(/\s+/)[0] ?? "";
      const accountUrl = `${this.siteUrl}/hesabim#degerlendirmelerim`;
      const footer = `Bu mesaj, “${d.productName}” için yaptığınız değerlendirme hakkında gönderilmiştir.`;
      delivery = await this.mail.send({
        purpose: "other", to: d.customer.email!, toName: d.customer.name, subject: subject!,
        text: `Merhaba ${firstName},\n\n${body}\n\n${brand}\n\n${footer}\nHesabım › Değerlendirmelerim: ${accountUrl}`,
        html: emailLayout(brand, `<p>Merhaba ${escapeHtml(firstName)},</p><p style="white-space:pre-line">${escapeHtml(body)}</p>
<p style="margin-top:24px;font-size:13px;color:#6b7280">${escapeHtml(footer)} <a href="${escapeHtml(accountUrl)}">Değerlendirmelerim</a></p>`),
      });
    } catch (err) {
      this.logger.warn("review contact e-mail failed", { reviewId: id, error: err instanceof Error ? err.message : String(err) });
      delivery = "failed";
    }
    await this.deps.db.batch([this.deps.reviews.setDeliveryStatement(contactId, delivery)]);
    return { contactId, delivery, contactStatus };
  }
}

export class SetReviewContactStatus {
  constructor(private readonly deps: ReviewDeps) {}

  async execute(id: string, status: ContactStatus, actor: Actor): Promise<void> {
    await new UnitOfWork(this.deps.db)
      .add(this.deps.reviews.contactStatusStatement(id, status, this.deps.clock.nowIso()))
      .expectChanges(1, ReviewErrors.notFound)
      .add(this.deps.audit.recordStatement({ actor, action: "review.contact_status", entityType: "review", entityId: id, diff: { contactStatus: CONTACT_STATUSES[status] } }))
      .commit();
  }
}

export class GetReviewSettings {
  constructor(private readonly reviews: ReviewRepository) {}
  execute(): Promise<ReviewSettings> { return this.reviews.settings(); }
}

export interface ReviewSettingsInput {
  moderationMode: ModerationMode;
  requirePurchase: boolean;
  allowAnonymous: boolean;
  minBodyLength: number;
  blockedWords: string[];
  expectedUpdatedAt: string;
}

export class UpdateReviewSettings {
  constructor(private readonly deps: ReviewDeps) {}

  async execute(input: ReviewSettingsInput, actor: Actor): Promise<ReviewSettings> {
    const { expectedUpdatedAt, ...s } = input;
    const blockedWords = [...new Set(s.blockedWords.map((w) => w.trim()).filter(Boolean))];
    await new UnitOfWork(this.deps.db)
      .add(this.deps.reviews.updateSettingsStatement({ ...s, blockedWords }, expectedUpdatedAt, actor.userId, this.deps.clock.nowIso()))
      .expectChanges(1, ReviewErrors.changedMeanwhile)
      .add(this.deps.audit.recordStatement({ actor, action: "review_settings.update", entityType: "review_settings", entityId: "1", diff: { ...s, blockedWords: blockedWords.length } }))
      .commit();
    return this.deps.reviews.settings();
  }
}
