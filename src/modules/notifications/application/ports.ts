import type { Statement } from "@/core";
import type { NotificationFilter, NotificationInput, NotificationSummary, NotificationType, NotificationView } from "../domain/notification";

/** Who is reading: the staff member and the permissions that decide which notifications they see. */
export interface Viewer {
  userId: string;
  permissions: string[];
}

export interface NotificationListQuery {
  filter: NotificationFilter;
  type?: NotificationType;
  page: number;
  pageSize: number;
}

export interface StoredRule {
  type: string;
  inApp: boolean;
  email: boolean;
  emailTo: string | null;
}

export interface NotificationRepository {
  list(viewer: Viewer, q: NotificationListQuery): Promise<{ rows: NotificationView[]; total: number; unread: number }>;
  summary(viewer: Viewer, latest: number): Promise<NotificationSummary>;
  /** Only ids the viewer can see are touched. `ids: "all"` = every visible, not archived notification. */
  markReadStatement(viewer: Viewer, ids: string[] | "all", read: boolean, now: string): Statement;
  archiveStatement(viewer: Viewer, ids: string[], archived: boolean, now: string): Statement;

  rules(): Promise<StoredRule[]>;
  rule(type: string): Promise<StoredRule | null>;
  upsertRuleStatement(rule: StoredRule, actorId: string, now: string): Statement;
  mutes(userId: string): Promise<string[]>;
  replaceMutesStatements(userId: string, types: string[]): Statement[];

  insertStatement(id: string, n: Required<NotificationInput>, permission: string, now: string): Statement;
  pruneStatement(before: string): Statement;
  dismissStatement(type: string, entityType: string, entityIds: string[]): Statement;
  emailOutboxStatement(id: string, payload: Record<string, unknown>, dedupeKey: string): Statement;
}

/**
 * Port other modules use to raise a panel notification inside their own UnitOfWork (the notification commits with
 * the business change, or not at all). Returns no statements when the type is switched off.
 */
export interface NotificationPublisher {
  statements(n: NotificationInput): Promise<Statement[]>;
  /** The subject was dealt with (e.g. the review was moderated): its notifications of that type disappear for everyone. */
  dismissStatement(type: NotificationType, entityType: string, entityIds: string[]): Statement;
}
