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
  /** Kapıda ödeme: the carrier collects this amount at the door (first parcel of the order only); null = prepaid. */
  cashOnDelivery?: { amountMinor: number } | null;
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

/** One invoice line, VAT-inclusive kuruş as charged (discounts already in the price). */
export interface InvoiceLineInput {
  sku: string;
  name: string;
  quantity: number;
  /** Line total paid for these units (VAT included, after discounts). */
  totalMinor: number;
  taxRateBps: number;
}

export interface InvoiceRequest {
  orderNumber: string;
  orderDate: string;
  /** Issue date (YYYY-MM-DD, Turkey time). */
  issueDate: string;
  currency: "TRY";
  buyer: {
    name: string;
    email: string;
    phone: string | null;
    /** Company name for a corporate invoice. */
    companyName: string | null;
    /** VKN (10 digits) or TCKN (11 digits); null = individual without TCKN (11111111111 is sent). */
    taxNumber: string | null;
    taxOffice: string | null;
    address: string;
    district: string;
    city: string;
    country: string;
  };
  lines: InvoiceLineInput[];
  /** Shipping + COD fee (VAT-inclusive kuruş, 20 % VAT). */
  shippingMinor: number;
  payment: { method: "card" | "transfer" | "cash_on_delivery"; platform: string | null; paidAt: string | null; amountMinor: number };
  shipment: { carrier: string | null; date: string | null };
  siteUrl: string;
}

/** Provider ids of a job between cron runs (opaque to the invoices module). */
export type InvoiceProgressState = Record<string, string | number | null>;

export type InvoiceStepResult =
  | { status: "running"; state: InvoiceProgressState; kind?: "e_arsiv" | "e_fatura" }
  | { status: "issued"; state: InvoiceProgressState; kind: "e_arsiv" | "e_fatura"; invoiceNumber: string; ettn: string | null; invoiceDate: string; totalMinor: number | null; pdf: Uint8Array | null }
  | { status: "failed"; state: InvoiceProgressState; error: string };

/**
 * Strategy: one adapter per e-invoice integrator. `advance` performs the next provider step for an order and
 * returns; the invoices module calls it again on the next cron run until "issued" / "failed". Throws on network
 * errors (retried with backoff).
 */
export interface AccountingConnector {
  readonly kind: "accounting";
  readonly code: string;
  advance(ctx: ConnectorContext & { refs: IntegrationRefs }, request: InvoiceRequest, state: InvoiceProgressState): Promise<InvoiceStepResult>;
  test(ctx: ConnectorContext): Promise<void>;
}

/** Remembered provider ids (contact per buyer, product per SKU). */
export interface IntegrationRefs {
  get(type: "contact" | "product", key: string): Promise<string | null>;
  set(type: "contact" | "product", key: string, externalId: string): Promise<void>;
}

export type Connector = CarrierConnector | SmsConnector | AccountingConnector;
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
