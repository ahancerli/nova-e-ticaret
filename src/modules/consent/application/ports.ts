import type { Statement } from "@/core";
import type { OrderTrackingContext, PurchaseFacts } from "../domain/server-tracking";
import type { BannerLayout, BannerTextKey, ConsentAction, ConsentChoices, ConsentProviderCode, ConsentSource, GoogleConsentMode } from "../domain/consent";

export interface ConsentSettingsRow {
  bannerEnabled: boolean;
  provider: ConsentProviderCode;
  providerConfig: Record<string, string>;
  layout: BannerLayout;
  texts: Partial<Record<BannerTextKey, string>>;
  googleConsentMode: GoogleConsentMode;
  maxAgeDays: number;
  revision: number;
  updatedAt: string;
}

export interface TrackingTagRow {
  code: string;
  isActive: boolean;
  config: Record<string, string>;
  updatedAt: string;
}

export interface ConsentRecordRow {
  id: string;
  visitorId: string;
  userId: string | null;
  customerEmail: string | null;
  revision: string;
  choices: ConsentChoices;
  action: ConsentAction;
  source: ConsentSource;
  userAgent: string | null;
  recordedAt: string;
}

export interface ConsentStats {
  total: number;
  acceptAll: number;
  rejectAll: number;
  custom: number;
  analytics: number;
  marketing: number;
}

export interface ConsentRepository {
  settings(): Promise<ConsentSettingsRow>;
  tags(): Promise<TrackingTagRow[]>;
  tag(code: string): Promise<TrackingTagRow | null>;

  /** Touches the row only while `updated_at` is still `expectedUpdatedAt` (UnitOfWork guard). */
  updateSettingsStatement(s: Omit<ConsentSettingsRow, "revision" | "updatedAt"> & { expectedUpdatedAt: string; actorId: string; now: string }): Statement;
  bumpRevisionStatement(actorId: string, now: string): Statement;
  insertTagStatement(t: { code: string; isActive: boolean; config: Record<string, string>; actorId: string; now: string }): Statement;
  updateTagStatement(t: { code: string; isActive: boolean; config: Record<string, string>; expectedUpdatedAt: string; actorId: string; now: string }): Statement;
  deleteTagStatement(code: string, expectedUpdatedAt: string): Statement;

  /** Stored server-side keys of every tag (hints only). */
  secretHints(): Promise<{ code: string; name: string; hint: string }[]>;
  sealedSecret(code: string, name: string): Promise<SealedSecret | null>;
  upsertSecretStatement(s: { code: string; name: string; sealed: SealedSecret; keyVersion: string; hint: string; now: string }): Statement;
  deleteSecretStatement(code: string, name: string): Statement;

  insertOrderContextStatement(ctx: Omit<OrderTrackingContext, "ga4SentAt" | "metaSentAt">): Statement;
  orderContext(orderId: string): Promise<OrderTrackingContext | null>;
  markSentStatement(orderId: string, vendor: "ga4" | "meta", now: string): Statement;
  /** Paid web order as the purchase event reports it; null when missing or not paid. */
  purchaseFacts(orderId: string): Promise<PurchaseFacts | null>;

  insertRecordStatement(r: {
    id: string; visitorId: string; userId: string | null; revision: string; choices: ConsentChoices; action: ConsentAction; source: ConsentSource;
    ipHash: string | null; userAgent: string | null; now: string;
  }): Statement;
  stats(sinceIso: string): Promise<ConsentStats>;
  records(filter: { visitorId?: string; limit: number; offset: number }): Promise<{ rows: ConsentRecordRow[]; total: number }>;
}

export interface SealedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
}

/** Published cookie policy (content module): its link and version. */
export type CookiePolicySource = () => Promise<{ href: string; title: string; version: number } | null>;
