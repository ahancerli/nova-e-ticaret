import { UnitOfWork, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import { emailLayout, escapeHtml, type MailSender } from "@/modules/mail";
import type { NotificationPublisher } from "@/modules/notifications";
import type { Actor } from "@/modules/shared/actor";
import { QuestionErrors } from "../domain/errors";
import {
  MAX_OPEN_PER_PRODUCT, QUESTION_MIN, QUESTION_PAGE_SIZE, cleanQuestionText,
  type AdminQuestionRow, type QuestionCounts, type QuestionInput, type QuestionPage,
} from "../domain/question";
import type { AdminQuestionQuery, QuestionRepository } from "./ports";

export interface QuestionDeps {
  db: Database;
  questions: QuestionRepository;
  notifications: NotificationPublisher;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface AnswerMail {
  mail: MailSender;
  brand: () => Promise<string>;
  siteUrl: string;
  logger: Logger;
}

/** Query: answered questions of a product (newest answer first) + the visitor's own unanswered ones. */
export class GetProductQuestions {
  constructor(private readonly questions: QuestionRepository) {}

  async execute(productId: string, opts: { page?: number; userId?: string | null } = {}): Promise<QuestionPage> {
    const page = Math.max(1, Math.min(opts.page ?? 1, 1000));
    const [{ items, total }, mine] = await Promise.all([
      this.questions.publicPage(productId, page, QUESTION_PAGE_SIZE),
      opts.userId ? this.questions.own(opts.userId, productId) : Promise.resolve([]),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / QUESTION_PAGE_SIZE)), mine };
  }

  /** Same for the browser's "Daha fazla soru" (product by slug; unknown / unpublished → 404). */
  async bySlug(slug: string, opts: { page?: number; userId?: string | null } = {}): Promise<QuestionPage> {
    const product = await this.questions.publishedProduct(slug);
    if (!product) throw QuestionErrors.productNotFound();
    return this.execute(product.id, opts);
  }
}

/**
 * Command: a signed-in customer asks about a product. Waits for the store's answer (never public before) and raises a
 * panel notification in the same transaction. Same text twice / too many open questions on one product are refused.
 */
export class AskQuestion {
  constructor(private readonly deps: QuestionDeps) {}

  async execute(productSlug: string, input: QuestionInput, actor: Actor): Promise<{ id: string; status: "pending" }> {
    const { questions } = this.deps;
    const product = await questions.publishedProduct(productSlug);
    if (!product) throw QuestionErrors.productNotFound();
    const body = cleanQuestionText(input.body);
    if (body.length < QUESTION_MIN) throw QuestionErrors.tooShort();
    const open = await questions.openBodies(actor.userId, product.id);
    const key = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
    if (open.some((o) => key(o) === key(body))) throw QuestionErrors.duplicate();
    if (open.length >= MAX_OPEN_PER_PRODUCT) throw QuestionErrors.tooMany();

    const id = this.deps.ids.newId();
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(questions.insertStatement({ id, productId: product.id, userId: actor.userId, body, isAnonymous: input.isAnonymous ?? false, now }))
      .add(...await this.deps.notifications.statements({
        type: "question.pending", title: "Yeni ürün sorusu", body: `${product.name} · “${body.length > 120 ? `${body.slice(0, 117)}…` : body}”`,
        href: `/admin/sorular?soru=${id}`, entityType: "product_question", entityId: id, dedupeKey: `question.pending:${id}`,
      }))
      .commit();
    return { id, status: "pending" };
  }
}

export class ListQuestions {
  constructor(private readonly questions: QuestionRepository) {}

  async execute(q: AdminQuestionQuery): Promise<{ rows: AdminQuestionRow[]; total: number; counts: QuestionCounts }> {
    const [{ rows, total }, counts] = await Promise.all([this.questions.list(q), this.questions.counts()]);
    return { rows, total, counts };
  }
}

export class GetQuestion {
  constructor(private readonly questions: QuestionRepository) {}

  async execute(id: string): Promise<AdminQuestionRow> {
    const q = await this.questions.get(id);
    if (!q) throw QuestionErrors.notFound();
    return q;
  }
}

/**
 * Command: publish (or edit) the store's answer. The asker is e-mailed once, after the commit, the first time the
 * question is answered; a mail failure never undoes the answer (`notified_at` stays empty).
 */
export class AnswerQuestion {
  constructor(private readonly deps: QuestionDeps, private readonly mail: AnswerMail) {}

  async execute(id: string, input: { answer: string; expectedUpdatedAt: string }, actor: Actor): Promise<AdminQuestionRow & { mailed: boolean }> {
    const { questions } = this.deps;
    const before = await questions.get(id);
    if (!before) throw QuestionErrors.notFound();
    const answer = cleanQuestionText(input.answer);
    if (!answer) throw QuestionErrors.answerRequired();
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(questions.answerStatement(id, answer, actor.userId, input.expectedUpdatedAt, now))
      .expectChanges(1, QuestionErrors.changed)
      .add(this.deps.notifications.dismissStatement("question.pending", "product_question", [id]))
      .add(this.deps.audit.recordStatement({
        actor, action: "question.answer", entityType: "product_question", entityId: id,
        diff: { product: before.productName, edited: before.status === "answered", answer: answer.length > 200 ? `${answer.slice(0, 197)}…` : answer },
      }))
      .commit();

    let mailed = false;
    if (!before.notifiedAt) mailed = await this.notify(before, answer);
    return { ...(await questions.get(id))!, mailed };
  }

  private async notify(q: AdminQuestionRow, answer: string): Promise<boolean> {
    try {
      const brand = await this.mail.brand();
      const url = `${this.mail.siteUrl}/urun/${encodeURIComponent(q.productSlug)}#sorular`;
      const firstName = q.customerName.split(/\s+/)[0] ?? "";
      const delivery = await this.mail.mail.send({
        purpose: "other", to: q.customerEmail, toName: q.customerName, subject: `“${q.productName}” hakkındaki sorunuz yanıtlandı`,
        text: `Merhaba ${firstName},\n\nSorunuz: ${q.body}\n\nYanıtımız: ${answer}\n\nÜrüne git: ${url}\n\n${brand}`,
        html: emailLayout(brand, `<p>Merhaba ${escapeHtml(firstName)},</p>
<p style="margin:16px 0 4px;font-size:13px;color:#6b7280">Sorunuz</p><p style="white-space:pre-line;margin:0">${escapeHtml(q.body)}</p>
<p style="margin:16px 0 4px;font-size:13px;color:#6b7280">Yanıtımız</p><p style="white-space:pre-line;margin:0">${escapeHtml(answer)}</p>
<p style="margin-top:24px"><a href="${escapeHtml(url)}">Ürüne git</a></p>`),
      });
      if (delivery !== "sent") return false;
      await this.deps.db.batch([this.deps.questions.markNotifiedStatement(q.id, this.deps.clock.nowIso())]);
      return true;
    } catch (err) {
      this.mail.logger.warn("question answer e-mail failed", { questionId: q.id, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
}

/** Command: keep a question off the shop (spam, personal data, off-topic). Unpublishes an answered one too. */
export class RejectQuestion {
  constructor(private readonly deps: QuestionDeps) {}

  async execute(id: string, input: { note?: string | null; expectedUpdatedAt: string }, actor: Actor): Promise<AdminQuestionRow> {
    const before = await this.deps.questions.get(id);
    if (!before) throw QuestionErrors.notFound();
    const note = input.note?.trim() || null;
    await new UnitOfWork(this.deps.db)
      .add(this.deps.questions.rejectStatement(id, note, input.expectedUpdatedAt, this.deps.clock.nowIso()))
      .expectChanges(1, QuestionErrors.changed)
      .add(this.deps.notifications.dismissStatement("question.pending", "product_question", [id]))
      .add(this.deps.audit.recordStatement({ actor, action: "question.reject", entityType: "product_question", entityId: id, diff: { product: before.productName, note } }))
      .commit();
    return (await this.deps.questions.get(id))!;
  }
}
