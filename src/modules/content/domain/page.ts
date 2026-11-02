/** Content page model (pure): kinds, legal document types, statuses and footer placement. */

export const PAGE_KINDS = {
  legal: "Yasal metin",
  corporate: "Kurumsal",
  help: "Yardım",
  general: "Genel",
} as const;
export type PageKind = keyof typeof PAGE_KINDS;

export const PAGE_STATUSES = {
  draft: { label: "Taslak", tone: "amber" },
  published: { label: "Yayında", tone: "green" },
  archived: { label: "Arşivde", tone: "slate" },
} as const;
export type PageStatus = keyof typeof PAGE_STATUSES;

/** Footer columns, in display order. */
export const FOOTER_COLUMNS = {
  corporate: "Kurumsal",
  help: "Yardım",
  legal: "Yasal",
} as const;
export type FooterColumn = keyof typeof FOOTER_COLUMNS;

/**
 * Legal documents a Turkish e-commerce shop publishes. `required` ones are flagged on the admin checklist when
 * missing; `checkout` ones are linked (and their versions recorded) on the checkout consent checkbox.
 */
export const LEGAL_TYPES = {
  distance_sales: { label: "Mesafeli satış sözleşmesi", slug: "mesafeli-satis-sozlesmesi", footer: "legal", required: true, checkout: true },
  pre_information: { label: "Ön bilgilendirme formu", slug: "on-bilgilendirme-formu", footer: "legal", required: true, checkout: true },
  kvkk: { label: "KVKK aydınlatma metni", slug: "kvkk-aydinlatma-metni", footer: "legal", required: true, checkout: false },
  privacy: { label: "Gizlilik politikası", slug: "gizlilik-politikasi", footer: "legal", required: true, checkout: false },
  cookies: { label: "Çerez politikası", slug: "cerez-politikasi", footer: "legal", required: true, checkout: false },
  return_policy: { label: "İade ve cayma koşulları", slug: "iade-ve-cayma-kosullari", footer: "help", required: true, checkout: false },
  terms_of_use: { label: "Kullanım koşulları", slug: "kullanim-kosullari", footer: "legal", required: false, checkout: false },
  membership: { label: "Üyelik sözleşmesi", slug: "uyelik-sozlesmesi", footer: "legal", required: false, checkout: false },
} as const satisfies Record<string, { label: string; slug: string; footer: FooterColumn; required: boolean; checkout: boolean }>;
export type LegalType = keyof typeof LEGAL_TYPES;
export const LEGAL_TYPE_KEYS = Object.keys(LEGAL_TYPES) as LegalType[];
export const isLegalType = (v: unknown): v is LegalType => typeof v === "string" && Object.hasOwn(LEGAL_TYPES, v);

export interface PageSeo {
  metaTitle: string | null;
  metaDescription: string | null;
  noindex: boolean;
}

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  kind: PageKind;
  legalType: LegalType | null;
  status: PageStatus;
  footerColumn: FooterColumn | null;
  footerOrder: number;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface PageDetail extends PageSummary {
  summary: string | null;
  bodyHtml: string;
  seo: PageSeo;
  createdAt: string;
}

export interface PageRevision {
  version: number;
  title: string;
  status: PageStatus;
  createdAt: string;
  createdByName: string | null;
}

export interface PageInput {
  title: string;
  slug?: string;
  kind: PageKind;
  legalType?: LegalType | null;
  summary?: string | null;
  bodyHtml: string;
  status: PageStatus;
  footerColumn?: FooterColumn | null;
  footerOrder?: number;
  seo?: Partial<PageSeo>;
}

export type PagePatch = Partial<PageInput> & { expectedVersion: number };

/** The published page as the storefront shows it (placeholders already filled, HTML sanitized). */
export interface PublishedPage {
  slug: string;
  title: string;
  summary: string | null;
  html: string;
  legalType: LegalType | null;
  version: number;
  updatedAt: string;
  seo: PageSeo;
}

export interface FooterLinkColumn {
  column: FooterColumn;
  label: string;
  links: { title: string; href: string }[];
}

export interface CheckoutLegal {
  distanceSales: { href: string; title: string; version: number } | null;
  preInformation: { href: string; title: string; version: number } | null;
  /** Stored with the order's consent (user_consents.document_version): which versions were accepted. */
  termsVersion: string;
}

/** Documents the storefront sign-up form links to; `version` is stored with the KVKK consent. */
export interface SignupLegal {
  kvkk: { href: string; title: string; version: number } | null;
  membership: { href: string; title: string; version: number } | null;
  privacy: { href: string; title: string } | null;
  consentVersion: string;
}

export const pageHref = (slug: string) => `/sayfa/${slug}`;
