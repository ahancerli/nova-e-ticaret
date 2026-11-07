import type { Statement } from "@/core";
import type {
  AdminReviewSort, ContactChannel, ContactDelivery, ContactStatus, ModerationAction, MyReview, PublicReview, PublicReviewSort, RatingSummary, RejectReason,
  ReviewableProduct, ReviewDetail, ReviewSettings, ReviewStats, ReviewStatus, ReviewSummaryRow, ReviewTab,
} from "../domain/review";

export interface OwnReview {
  id: string;
  version: number;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  body: string;
  isAnonymous: boolean;
  rejectReason: RejectReason | null;
}

/** Columns a customer writes (validated, cleaned). */
export interface ReviewWrite {
  rating: number;
  title: string | null;
  body: string;
  isAnonymous: boolean;
  verifiedPurchase: boolean;
  orderItemId: string | null;
  variantId: string | null;
  status: "pending" | "approved";
}

export interface AdminReviewQuery {
  tab: ReviewTab;
  rating?: number;
  q?: string;
  productId?: string;
  sort: AdminReviewSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface ReviewRepository {
  // shop
  publishedProduct(by: { slug: string } | { id: string }): Promise<{ id: string; name: string; slug: string } | null>;
  summary(productId: string): Promise<RatingSummary>;
  publicPage(productId: string, q: { sort: PublicReviewSort; rating?: number; page: number; pageSize: number }): Promise<{ items: PublicReview[]; total: number }>;
  /** The customer's latest paid, not cancelled order line of the product. */
  purchase(userId: string, productId: string): Promise<{ orderItemId: string; variantId: string } | null>;
  own(userId: string, productId: string): Promise<OwnReview | null>;
  customerName(userId: string): Promise<{ first: string | null; last: string | null; display: string; email: string } | null>;
  insertStatement(id: string, productId: string, userId: string, w: ReviewWrite, now: string): Statement;
  /** Guarded by version: 0 rows = edited meanwhile. */
  updateOwnStatement(id: string, expectedVersion: number, w: ReviewWrite, now: string): Statement;
  voteTarget(reviewId: string): Promise<{ userId: string; status: ReviewStatus } | null>;
  voteStatements(reviewId: string, userId: string, helpful: boolean): Statement[];
  helpfulCount(reviewId: string): Promise<number>;
  myReviews(userId: string): Promise<MyReview[]>;
  reviewable(userId: string, limit: number): Promise<ReviewableProduct[]>;

  // settings
  settings(): Promise<ReviewSettings>;
  updateSettingsStatement(s: Omit<ReviewSettings, "updatedAt">, expectedUpdatedAt: string, actorId: string, now: string): Statement;

  // panel
  list(q: AdminReviewQuery): Promise<{ rows: ReviewSummaryRow[]; total: number }>;
  stats(): Promise<ReviewStats>;
  detail(id: string): Promise<ReviewDetail | null>;
  statuses(ids: string[]): Promise<{ id: string; status: ReviewStatus; productName: string }[]>;
  moderateStatement(ids: string[], action: ModerationAction, reason: RejectReason | null, note: string | null, actorId: string, now: string): Statement;
  replyStatement(id: string, body: string | null, actorId: string, now: string): Statement;
  contactStatusStatement(id: string, status: ContactStatus, now: string): Statement;
  insertContactStatement(c: { id: string; reviewId: string; channel: ContactChannel; subject: string | null; body: string; delivery: ContactDelivery; visibleToCustomer: boolean; actorId: string; now: string }): Statement;
  setDeliveryStatement(contactId: string, delivery: ContactDelivery): Statement;
}
