import type { Statement } from "@/core";
import type { IntegrationKind, IntegrationSettings, ProviderField, SupportStatus } from "../domain/providers";

/** What an adapter gets: the integration's non-secret values and its decrypted secrets (never logged). */
export interface ConnectorContext {
  values: Record<string, string>;
  secrets: Record<string, string>;
}

export interface CarrierBooking {
  /** Our stable reference for this parcel (idempotency key at the carrier). */
  cargoKey: string;
  orderNumber: string;
  pieces: number;
  receiver: { name: string; phone: string; email: string; province: string; district: string; address: string };
}

export type CarrierStatus = "pending" | "in_transit" | "delivered" | "returned" | "lost" | "cancelled";

export interface CarrierTracking {
  cargoKey: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: CarrierStatus;
  /** The carrier's own wording / code, shown in the panel. */
  carrierStatus: string;
  occurredAt: string | null;
}

/** Strategy: one adapter per cargo firm. `book` is idempotent per cargoKey (`alreadyBooked` on a repeat). */
export interface CarrierConnector {
  readonly kind: "shipping";
  readonly code: string;
  book(ctx: ConnectorContext, booking: CarrierBooking): Promise<{ providerRef: string | null; alreadyBooked: boolean }>;
  track(ctx: ConnectorContext, cargoKeys: string[]): Promise<CarrierTracking[]>;
  /** Proves the credentials without creating anything. Throws IntegrationErrors. */
  test(ctx: ConnectorContext): Promise<void>;
}

/** Strategy: one adapter per SMS firm. `to` = Turkish mobiles as 5XXXXXXXXX. Throws IntegrationErrors. */
export interface SmsConnector {
  readonly kind: "sms";
  readonly code: string;
  send(ctx: ConnectorContext, message: { to: string[]; text: string }): Promise<{ providerRef: string | null }>;
}

export type Connector = CarrierConnector | SmsConnector;
/** Adapters shipped with the app, by provider code (tests replace the registry). */
export type ConnectorRegistry = ReadonlyMap<string, Connector>;

export interface ProviderRow {
  code: string;
  kind: IntegrationKind;
  name: string;
  description: string | null;
  website: string | null;
  supportStatus: SupportStatus;
  fields: ProviderField[];
  capabilities: string[];
}

export interface IntegrationRow {
  id: string;
  kind: IntegrationKind;
  providerCode: string;
  isActive: boolean;
  values: Record<string, string>;
  settings: IntegrationSettings;
  /** Names of stored secrets. */
  secrets: string[];
  updatedAt: string;
}

export interface SealedSecret {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export interface IntegrationRepository {
  providers(kind: IntegrationKind): Promise<ProviderRow[]>;
  provider(code: string): Promise<ProviderRow | null>;
  current(kind: IntegrationKind): Promise<IntegrationRow | null>;

  /** Touches 1 row only while `updated_at` is still `expectedUpdatedAt`. */
  lockStatement(id: string, expectedUpdatedAt: string): Statement;
  deleteKindStatement(kind: IntegrationKind): Statement;
  insertStatement(row: { id: string; kind: IntegrationKind; providerCode: string; name: string; publicConfig: unknown; now: string }): Statement;
  updateStatement(row: { id: string; publicConfig: unknown; now: string }): Statement;
  replaceSecretStatements(row: { id: string; integrationId: string; name: string; secret: SealedSecret; now: string }): Statement[];
}
