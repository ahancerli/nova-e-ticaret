/**
 * Shop-wide commerce events — one vocabulary for every tracking vendor. Screens call `track()` (features/consent)
 * with these; each tag adapter translates them (GA4 / GTM dataLayer use them nearly as-is, Meta → ViewContent,
 * AddToCart, Purchase …). Amounts are TL decimals (VAT inclusive), never kuruş.
 */

export const TRACK_CURRENCY = "TRY";

export interface TrackItem {
  /** SKU when known, else product id. */
  id: string;
  name: string;
  brand?: string | null;
  category?: string | null;
  variant?: string | null;
  price: number;
  quantity: number;
}

export type CommerceEvent =
  | { name: "view_item"; item: TrackItem }
  | { name: "view_item_list"; listName: string; items: TrackItem[] }
  | { name: "add_to_cart"; items: TrackItem[]; value: number }
  | { name: "remove_from_cart"; items: TrackItem[]; value: number }
  | { name: "view_cart"; items: TrackItem[]; value: number }
  | { name: "begin_checkout"; items: TrackItem[]; value: number; coupon?: string | null }
  | { name: "purchase"; transactionId: string; items: TrackItem[]; value: number; shipping: number; tax?: number; coupon?: string | null }
  | { name: "search"; term: string }
  | { name: "sign_up"; method: string }
  | { name: "login"; method: string };

export type CommerceEventName = CommerceEvent["name"];

/** kuruş → TL decimal (2 places). */
export const toAmount = (minor: number) => Math.round(minor) / 100;

export const itemsValue = (items: TrackItem[]) => Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
