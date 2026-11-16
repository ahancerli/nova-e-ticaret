import type { Channel, InboundMessage } from "../domain/social-ai";

export interface Sealed { ciphertext: string; nonce: string; authTag: string; keyVersion: string }

/** A connected account with its decrypted access token (server only). */
export interface ChannelCredentials {
  externalId: string;
  accountId: string | null;
  accessToken: string;
}

export interface OutboundMessage {
  to: string;
  text: string;
  /** Written by a person: Instagram sends it with the human agent tag (7 day window). */
  humanAgent: boolean;
  /** Ask the channel to render a link preview (WhatsApp `preview_url`). */
  linkPreview: boolean;
}

/**
 * A send that Meta refused or that never reached it. `permanent` = retrying cannot help (bad recipient, closed
 * window, revoked token); `auth` = the token or its permissions are the problem → the channel is marked broken.
 */
export class ChannelSendError extends Error {
  constructor(message: string, readonly permanent: boolean, readonly auth = false, readonly code: string | null = null) {
    super(message);
    this.name = "ChannelSendError";
  }
}

/**
 * Everything channel specific (Adapter): reading that channel's webhook payload into the common message format and
 * sending text. A new channel (web chat, Telegram) = one more adapter; the conversation service does not change.
 */
export interface ChannelAdapter {
  readonly channel: Channel;
  /** The `object` value of webhook payloads this adapter reads. */
  readonly webhookObject: string;
  /** Customer messages in the payload; echoes, statuses and anything unknown are dropped. */
  parse(payload: unknown): InboundMessage[];
  /** Throws ChannelSendError. */
  send(credentials: ChannelCredentials, message: OutboundMessage): Promise<{ externalId: string | null }>;
  /** Public profile of a contact, where the channel offers one (Instagram). Throws on failure. */
  profile?(credentials: ChannelCredentials, contactId: string): Promise<ContactProfile>;
}
export interface ContactProfile { username: string | null; name: string | null; avatarUrl: string | null }
export type ChannelAdapters = (channel: Channel) => ChannelAdapter;

export interface ConnectedAccount {
  externalId: string;
  accountId: string | null;
  displayName: string | null;
  accessToken: string;
  /** Seconds until the token expires; null = it does not. */
  expiresIn: number | null;
}

/** Meta calls of the set-up wizard and upkeep (OAuth exchange, webhook subscription, token refresh). Tests fake it. */
export interface MetaConnect {
  /** WhatsApp Embedded Signup: code → business token, subscribe the app to the WABA, read the number. */
  connectWhatsApp(app: { appId: string; appSecret: string }, input: { code: string; wabaId: string; phoneNumberId: string }): Promise<ConnectedAccount>;
  /** Instagram Login: code → long-lived token, read the account, subscribe it to message webhooks. */
  connectInstagram(app: { igAppId: string; igAppSecret: string }, input: { code: string; redirectUri: string }): Promise<ConnectedAccount>;
  /** Manual credentials / "bağlantıyı test et": reads the account with the token and (re)subscribes webhooks. */
  verify(channel: Channel, credentials: ChannelCredentials): Promise<{ displayName: string | null }>;
  refreshInstagramToken(accessToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  /** Best effort on disconnect. */
  unsubscribe(channel: Channel, credentials: ChannelCredentials): Promise<void>;
}

// --- shop knowledge the bot's tools read ----------------------------------------------------------------------------

export interface ProductBrief {
  id: string;
  name: string;
  brand: string | null;
  priceMinor: number | null;
  /** "Sepette" price after automatic product campaigns, when lower. */
  cartPriceMinor: number | null;
  compareAtMinor: number | null;
  inStock: boolean;
  campaigns: string[];
  url: string;
}

export interface ProductInfo extends ProductBrief {
  shortDescription: string | null;
  description: string | null;
  variants: { options: string; priceMinor: number | null; cartPriceMinor: number | null; inStock: boolean; fewLeft: boolean }[];
  specs: { label: string; value: string }[];
  sizeChart: { name: string; columns: string[]; rows: string[][]; note: string | null } | null;
  questions: { question: string; answer: string }[];
  rating: number | null;
  ratingCount: number;
}

export interface ContentHit { title: string; url: string | null; excerpt: string }

export interface ShippingInfo {
  methods: { name: string; feeMinor: number; freeAboveMinor: number | null }[];
  /** "Bugün 15:00'e kadar verilen siparişler yarın kargoda" style sentence; null when the shop gives no estimate. */
  estimate: string | null;
}

export interface OrderStatusInfo {
  orderNumber: string;
  placedAt: string;
  statusLabel: string;
  paymentLabel: string;
  totalMinor: number;
  items: { name: string; quantity: number }[];
  shipments: { statusLabel: string; trackingNumber: string | null; trackingUrl: string | null; shippedAt: string | null; deliveredAt: string | null }[];
}

export interface StoreProfile { name: string; siteUrl: string; email: string | null; phone: string | null; hours: string | null; address: string | null }

/** What the bot may know about the shop — read only, published data only. Implemented on the other modules' queries. */
export interface StoreKnowledge {
  store(): Promise<StoreProfile>;
  searchProducts(query: string, opts: { inStockOnly?: boolean; maxPriceMinor?: number | null; limit?: number }): Promise<ProductBrief[]>;
  product(id: string): Promise<ProductInfo | null>;
  productsByIds(ids: string[]): Promise<ProductBrief[]>;
  searchContent(query: string): Promise<ContentHit[]>;
  shipping(): Promise<ShippingInfo>;
  /** Null unless the order number AND one of e-mail / phone match the order (never reveals that an order exists). */
  orderStatus(orderNumber: string, proof: { email?: string | null; phones: string[] }): Promise<OrderStatusInfo | null>;
}
