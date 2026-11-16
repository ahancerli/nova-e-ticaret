/** Ürün soru-cevap — pure types, labels and limits (no I/O). Only answered questions are public. */

export const QUESTION_STATUSES = { pending: "Yanıt bekliyor", answered: "Yanıtlandı", rejected: "Yayınlanmadı" } as const;
export type QuestionStatus = keyof typeof QUESTION_STATUSES;
export const QUESTION_TABS = { pending: "Yanıt bekleyen", answered: "Yanıtlanan", rejected: "Yayınlanmayan", all: "Tümü" } as const;
export type QuestionTab = keyof typeof QUESTION_TABS;
export const ADMIN_QUESTION_SORTS = ["created_at", "answered_at", "product_name"] as const;
export type AdminQuestionSort = (typeof ADMIN_QUESTION_SORTS)[number];

export const QUESTION_MIN = 5;
export const QUESTION_MAX = 500;
export const ANSWER_MAX = 2000;
export const NOTE_MAX = 500;
export const QUESTION_PAGE_SIZE = 10;
/** Unanswered questions one customer may have open on one product (spam brake). */
export const MAX_OPEN_PER_PRODUCT = 3;

export interface PublicQuestion {
  id: string;
  body: string;
  authorName: string;
  askedAt: string;
  answer: string;
  answeredAt: string;
}

/** The signed-in customer's own questions on the product that are not public (yet). */
export interface OwnQuestion {
  id: string;
  body: string;
  status: Exclude<QuestionStatus, "answered">;
  createdAt: string;
}

export interface QuestionPage {
  items: PublicQuestion[];
  total: number;
  page: number;
  pages: number;
  mine: OwnQuestion[];
}

export interface QuestionInput {
  body: string;
  isAnonymous?: boolean;
}

export interface AdminQuestionRow {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  productImageUrl: string | null;
  body: string;
  customerName: string;
  customerEmail: string;
  isAnonymous: boolean;
  status: QuestionStatus;
  answerBody: string | null;
  answeredAt: string | null;
  answeredByName: string | null;
  rejectNote: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QuestionCounts = Record<QuestionTab, number>;

export const cleanQuestionText = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
