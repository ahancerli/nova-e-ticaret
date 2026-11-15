import type { Statement } from "@/core";
import type { SubscriberQuery, SubscriberRow, SubscriberSource, SubscriberStatus, SubscriberTab } from "../domain/newsletter";

export interface StoredSubscriber {
  id: string;
  email: string;
  status: SubscriberStatus;
  userId: string | null;
  confirmSentAt: string | null;
  confirmExpiresAt: string | null;
}

export interface NewsletterRepository {
  findByEmail(email: string): Promise<StoredSubscriber | null>;
  find(id: string): Promise<StoredSubscriber | null>;
  /** Pending subscriber whose confirmation token hash matches and has not expired. */
  findByToken(tokenHash: string, now: string): Promise<StoredSubscriber | null>;
  memberIdByEmail(email: string): Promise<string | null>;

  insertStatement(row: { id: string; email: string; userId: string | null; source: SubscriberSource; consentVersion: string; tokenHash: string; expiresAt: string; ipHash: string; now: string }): Statement;
  /** pending / unsubscribed → pending with a fresh token (guarded on the status read). */
  renewStatement(row: { id: string; from: SubscriberStatus; userId: string | null; consentVersion: string; tokenHash: string; expiresAt: string; ipHash: string; now: string }): Statement;
  /** Guarded: pending + same token → subscribed. */
  confirmStatement(id: string, tokenHash: string, now: string): Statement;
  /** Guarded: subscribed / pending → unsubscribed. */
  unsubscribeStatement(id: string, now: string): Statement;
  deleteStatement(id: string): Statement;
  consentStatement(row: { id: string; userId: string | null; guestHash: string | null; version: string; granted: boolean; now: string }): Statement;

  list(q: SubscriberQuery): Promise<{ rows: SubscriberRow[]; total: number; counts: Record<SubscriberTab, number> }>;
}
