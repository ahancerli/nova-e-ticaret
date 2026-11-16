import type { Statement } from "@/core";
import type { AdminQuestionRow, AdminQuestionSort, OwnQuestion, PublicQuestion, QuestionCounts, QuestionStatus, QuestionTab } from "../domain/question";

export interface AdminQuestionQuery {
  tab: QuestionTab;
  q?: string;
  productId?: string;
  sort: AdminQuestionSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface QuestionRepository {
  publishedProduct(slug: string): Promise<{ id: string; name: string } | null>;
  publicPage(productId: string, page: number, pageSize: number): Promise<{ items: PublicQuestion[]; total: number }>;
  own(userId: string, productId: string): Promise<OwnQuestion[]>;
  openBodies(userId: string, productId: string): Promise<string[]>;
  insertStatement(q: { id: string; productId: string; userId: string; body: string; isAnonymous: boolean; now: string }): Statement;

  list(q: AdminQuestionQuery): Promise<{ rows: AdminQuestionRow[]; total: number }>;
  counts(): Promise<QuestionCounts>;
  get(id: string): Promise<AdminQuestionRow | null>;
  /** Publishes (or edits) the answer; guarded by `updated_at`. */
  answerStatement(id: string, answer: string, actorId: string, expectedUpdatedAt: string, now: string): Statement;
  rejectStatement(id: string, note: string | null, expectedUpdatedAt: string, now: string): Statement;
  markNotifiedStatement(id: string, now: string): Statement;
}

export type { QuestionStatus };
