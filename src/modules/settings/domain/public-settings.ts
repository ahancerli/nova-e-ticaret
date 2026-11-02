import { SETTINGS, type SettingDef } from "./registry";
import type { LinkValue, SettingValue } from "./values";

/** Typed, storefront-safe view of the public settings (only `public: true` keys reach it). */
export interface PublicSettings {
  siteName: string;
  tagline: string | null;
  announcement: LinkValue | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  accentColor: string | null;
  company: {
    legalName: string | null; address: string | null; taxOffice: string | null; taxNumber: string | null;
    mersisNo: string | null; tradeRegistryNo: string | null; kepAddress: string | null;
  };
  contact: { email: string | null; phone: string | null; whatsapp: string | null; hours: string | null };
  seo: { defaultTitle: string; titleTemplate: string; description: string | null; ogImageUrl: string | null; allowIndexing: boolean; googleVerification: string | null };
  social: { network: SocialNetwork; label: string; url: string }[];
  footer: { copyright: string | null; trustBadges: string[]; paymentNote: string | null };
}

export const SOCIAL_NETWORKS = ["instagram", "facebook", "x", "youtube", "tiktok", "linkedin"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

const FALLBACK_NAME = "Mağaza";

/** Values keyed by setting key; image settings already resolved to their public URL by the caller. */
export function toPublicSettings(values: Record<string, SettingValue>, imageUrl: (mediaId: string) => string | null): PublicSettings {
  const str = (k: string) => (typeof values[k] === "string" && (values[k] as string).trim() ? (values[k] as string) : null);
  const img = (k: string) => (str(k) ? imageUrl(str(k)!) : null);
  const siteName = str("site.name") ?? FALLBACK_NAME;
  const announcement = values["site.announcement"];
  const badges = values["footer.trust_badges"];

  return {
    siteName,
    tagline: str("site.tagline"),
    announcement: announcement && typeof announcement === "object" && !Array.isArray(announcement) ? (announcement as LinkValue) : null,
    logoUrl: img("branding.logo_media_id"),
    faviconUrl: img("branding.favicon_media_id"),
    accentColor: str("branding.accent_color"),
    company: {
      legalName: str("company.legal_name"), address: str("company.address"), taxOffice: str("company.tax_office"), taxNumber: str("company.tax_number"),
      mersisNo: str("company.mersis_no"), tradeRegistryNo: str("company.trade_registry_no"), kepAddress: str("company.kep_address"),
    },
    contact: { email: str("contact.email"), phone: str("contact.phone"), whatsapp: str("contact.whatsapp"), hours: str("contact.hours") },
    seo: {
      defaultTitle: str("seo.default_title") ?? siteName,
      titleTemplate: str("seo.title_template")?.includes("%s") ? str("seo.title_template")! : `%s | ${siteName}`,
      description: str("seo.default_description"),
      ogImageUrl: img("seo.og_image_media_id"),
      allowIndexing: values["seo.allow_indexing"] !== false,
      googleVerification: str("seo.google_verification"),
    },
    social: SOCIAL_NETWORKS.flatMap((network) => {
      const url = str(`social.${network}`);
      const def = SETTINGS.find((s) => s.key === `social.${network}`);
      return url && def ? [{ network, label: def.label, url }] : [];
    }),
    footer: {
      copyright: str("footer.copyright"),
      trustBadges: Array.isArray(badges) ? badges.filter((b): b is string => typeof b === "string" && b.trim() !== "") : [],
      paymentNote: str("footer.payment_note"),
    },
  };
}

/**
 * Placeholder values for content templates ({{firma.unvan}} …). Every registry entry with a templateVar is
 * present (empty string when unset) so editors can tell "unset" from "unknown placeholder".
 */
export function templateVariables(values: Record<string, SettingValue>, extra: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of SETTINGS as readonly SettingDef[]) {
    if (!def.templateVar) continue;
    const v = values[def.key];
    out[def.templateVar] = typeof v === "string" ? v : "";
  }
  return { ...out, ...extra };
}

/** Placeholders available to editors, with a human label (for the "insert variable" menu). */
export const TEMPLATE_VARIABLES: { name: string; label: string }[] = [
  ...SETTINGS.filter((s) => s.templateVar).map((s) => ({ name: s.templateVar!, label: s.label })),
  { name: "site.adres", label: "Mağaza web adresi" },
  { name: "tarih.yil", label: "İçinde bulunulan yıl" },
  { name: "sayfa.guncelleme", label: "Sayfanın son güncellenme tarihi" },
];
