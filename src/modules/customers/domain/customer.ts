/** Storefront members (customer accounts) as the admin sees them — pure types. */

export const CUSTOMER_SEGMENTS = {
  all: "Tümü",
  buyers: "Sipariş verenler",
  no_orders: "Henüz sipariş yok",
  marketing: "İleti izni verenler",
  suspended: "Askıda",
} as const;
export type CustomerSegment = keyof typeof CUSTOMER_SEGMENTS;

export const CUSTOMER_SORTS = ["created_at", "last_order_at", "total_spent", "order_count", "name"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const CONSENT_LABELS: Record<string, string> = {
  kvkk_notice: "KVKK aydınlatma metni",
  marketing_email: "E-posta ile ticari ileti",
  marketing_sms: "SMS ile ticari ileti",
  cookies_analytics: "Analitik çerezler",
  distance_sales: "Mesafeli satış sözleşmesi",
};

export interface CustomerSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: "active" | "suspended";
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: string | null;
  marketingEmail: boolean;
  marketingSms: boolean;
}

export interface CustomerQuery {
  q?: string;
  segment: CustomerSegment;
  sort: CustomerSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface CustomerList {
  rows: CustomerSummary[];
  total: number;
  segmentCounts: Record<CustomerSegment, number>;
}

export interface CustomerDetail extends CustomerSummary {
  firstName: string;
  lastName: string;
  companyName: string | null;
  notes: string | null;
  passwordChangedAt: string | null;
  activeSessions: number;
  stats: { paidOrderCount: number; averageOrderMinor: number; firstOrderAt: string | null; refundedMinor: number };
  addresses: { id: string; label: string; recipientName: string; phone: string; province: string; district: string; line1: string; isDefaultShipping: boolean; isDefaultBilling: boolean }[];
  consents: { purpose: string; label: string; granted: boolean; version: string; recordedAt: string; withdrawnAt: string | null }[];
  orders: { id: string; orderNumber: string; placedAt: string; status: string; paymentStatus: string; totalMinor: number }[];
}

export interface CustomerPatch {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  companyName?: string | null;
  notes?: string | null;
}

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  password: string;
  marketingEmail: boolean;
  marketingSms: boolean;
}
